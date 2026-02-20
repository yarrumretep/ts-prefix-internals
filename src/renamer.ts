import ts from 'typescript';

interface PendingEdit {
  fileName: string;
  start: number;
  length: number;
  newText: string;
}

export interface RenameResult {
  outputFiles: Map<string, string>;
  errors: string[];
}

export function computeRenames(
  languageService: ts.LanguageService,
  program: ts.Program,
  symbolsToRename: Map<ts.Symbol, string>
): RenameResult {
  const allEdits: PendingEdit[] = [];
  const errors: string[] = [];

  // Collect original source texts
  const originalSources = new Map<string, string>();
  for (const sf of program.getSourceFiles()) {
    originalSources.set(sf.fileName, sf.getFullText());
  }

  // Gather all rename edits
  for (const [symbol, newName] of symbolsToRename) {
    const decls = symbol.getDeclarations();
    if (!decls || decls.length === 0) continue;

    let targetFile: string | undefined;
    let targetPos: number | undefined;

    for (const decl of decls) {
      const sf = decl.getSourceFile();
      if (sf.isDeclarationFile || sf.fileName.includes('node_modules')) continue;

      let nameNode: ts.Node | undefined;
      if ('name' in decl && (decl as any).name) {
        nameNode = (decl as any).name;
      }

      if (nameNode) {
        targetFile = sf.fileName;
        targetPos = nameNode.getStart();
        break;
      }
    }

    if (targetFile === undefined || targetPos === undefined) continue;

    const locations = languageService.findRenameLocations(
      targetFile, targetPos, false, false, true
    );

    if (!locations) {
      errors.push(`Could not find rename locations for ${symbol.getName()} at ${targetFile}:${targetPos}`);
      continue;
    }

    for (const loc of locations) {
      // TypeScript's Language Service provides prefixText/suffixText when
      // renaming a shorthand property requires expansion.  For example,
      // renaming the property `model` to `__model` in `return { model }`
      // yields suffixText ": model" so the output becomes `{ __model: model }`.
      // Similarly, `const { model } = ...` may yield prefixText "model: ".
      allEdits.push({
        fileName: loc.fileName,
        start: loc.textSpan.start,
        length: loc.textSpan.length,
        newText: (loc.prefixText ?? '') + newName + (loc.suffixText ?? ''),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Second pass: catch property accesses through anonymous type casts.
  //
  // findRenameLocations is symbol-based: if code uses an `as` cast with an
  // inline type literal (e.g. `(x as { value: T }).value`), TS creates a
  // fresh symbol for the anonymous type's `value` property.  The rename of
  // `ParseSuccess.value` → `__value` never reaches that access.
  //
  // Fix: walk the AST for property accesses whose name matches a renamed
  // property but whose position wasn't covered by findRenameLocations.
  // If the resolved property is declared in a project source file (not
  // lib.d.ts / node_modules), it's a missed rename — add edits for the
  // access AND for every declaration of that anonymous property symbol.
  // ---------------------------------------------------------------------------
  const checker = program.getTypeChecker();

  // Build lookup: original property name → new name
  const renamedPropNames = new Map<string, string>();
  for (const [symbol, newName] of symbolsToRename) {
    const decls = symbol.getDeclarations();
    if (!decls) continue;
    const isProperty = decls.some(d =>
      ts.isPropertyDeclaration(d) ||
      ts.isPropertySignature(d) ||
      ts.isGetAccessorDeclaration(d) ||
      ts.isSetAccessorDeclaration(d) ||
      ts.isPropertyAssignment(d) ||
      ts.isShorthandPropertyAssignment(d) ||
      ts.isEnumMember(d)
    );
    if (isProperty) {
      renamedPropNames.set(symbol.getName(), newName);
    }
  }

  // Build set of positions already covered
  const editedPositions = new Set<string>();
  for (const edit of allEdits) {
    editedPositions.add(`${edit.fileName}:${edit.start}`);
  }

  // Helper: rename all declarations of a property symbol that haven't been
  // edited yet (e.g. inline anonymous type literals)
  function renamePropertyDeclarations(propDecls: ts.Declaration[] | undefined, propName: string, newName: string): void {
    if (!propDecls) return;
    for (const d of propDecls) {
      const declSf = d.getSourceFile();
      if (declSf.isDeclarationFile || declSf.fileName.includes('node_modules')) continue;
      const declName = (ts.isPropertySignature(d) || ts.isPropertyDeclaration(d))
        ? d.name
        : undefined;
      if (declName && ts.isIdentifier(declName)) {
        const declPos = declName.getStart();
        const key = `${declSf.fileName}:${declPos}`;
        if (!editedPositions.has(key)) {
          allEdits.push({
            fileName: declSf.fileName,
            start: declPos,
            length: propName.length,
            newText: newName,
          });
          editedPositions.add(key);
        }
      }
    }
  }

  // Helper: check if a property is declared in project source (not lib/node_modules)
  function isProjectProperty(prop: ts.Symbol): boolean {
    const propDecls = prop.getDeclarations();
    return propDecls?.some(d => {
      const dsf = d.getSourceFile();
      return !dsf.isDeclarationFile && !dsf.fileName.includes('node_modules');
    }) ?? false;
  }

  // Walk AST
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || sf.fileName.includes('node_modules')) continue;

    const visit = (node: ts.Node): void => {
      // Case 1: property access expressions — obj.prop
      if (ts.isPropertyAccessExpression(node)) {
        const propName = node.name.text;
        const newName = renamedPropNames.get(propName);
        if (newName !== undefined) {
          const pos = node.name.getStart();
          if (!editedPositions.has(`${sf.fileName}:${pos}`)) {
            const type = checker.getTypeAtLocation(node.expression);
            const prop = type.getProperty(propName);
            if (prop && isProjectProperty(prop)) {
              allEdits.push({
                fileName: sf.fileName,
                start: pos,
                length: propName.length,
                newText: newName,
              });
              editedPositions.add(`${sf.fileName}:${pos}`);
              renamePropertyDeclarations(prop.getDeclarations(), propName, newName);
            }
          }
        }
      }

      // Case 2: property assignment in object literals — { key: value }
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
        const propName = node.name.text;
        const newName = renamedPropNames.get(propName);
        if (newName !== undefined) {
          const pos = node.name.getStart();
          if (!editedPositions.has(`${sf.fileName}:${pos}`)) {
            const objLit = node.parent;
            if (ts.isObjectLiteralExpression(objLit)) {
              const contextualType = checker.getContextualType(objLit);
              if (contextualType) {
                const prop = contextualType.getProperty(propName);
                if (prop && isProjectProperty(prop)) {
                  allEdits.push({
                    fileName: sf.fileName,
                    start: pos,
                    length: propName.length,
                    newText: newName,
                  });
                  editedPositions.add(`${sf.fileName}:${pos}`);
                  renamePropertyDeclarations(prop.getDeclarations(), propName, newName);
                }
              }
            }
          }
        }
      }

      // Case 3: shorthand property in object literals — { key }
      // Must expand to { __key: key } when the property is renamed
      if (ts.isShorthandPropertyAssignment(node)) {
        const propName = node.name.text;
        const newName = renamedPropNames.get(propName);
        if (newName !== undefined) {
          const pos = node.name.getStart();
          if (!editedPositions.has(`${sf.fileName}:${pos}`)) {
            const objLit = node.parent;
            if (ts.isObjectLiteralExpression(objLit)) {
              const contextualType = checker.getContextualType(objLit);
              if (contextualType) {
                const prop = contextualType.getProperty(propName);
                if (prop && isProjectProperty(prop)) {
                  // Expand shorthand: { model } → { __model: model }
                  allEdits.push({
                    fileName: sf.fileName,
                    start: pos,
                    length: propName.length,
                    newText: `${newName}: ${propName}`,
                  });
                  editedPositions.add(`${sf.fileName}:${pos}`);
                  renamePropertyDeclarations(prop.getDeclarations(), propName, newName);
                }
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sf, visit);
  }

  // Group edits by file
  const editsByFile = new Map<string, PendingEdit[]>();
  for (const edit of allEdits) {
    const existing = editsByFile.get(edit.fileName) ?? [];
    existing.push(edit);
    editsByFile.set(edit.fileName, existing);
  }

  // Apply edits bottom-to-top per file
  const outputFiles = new Map<string, string>();
  for (const [fileName, edits] of editsByFile) {
    // Deduplicate edits at the same position
    const deduped = new Map<string, PendingEdit>();
    for (const edit of edits) {
      const key = `${edit.start}:${edit.length}`;
      deduped.set(key, edit);
    }
    const uniqueEdits = [...deduped.values()];

    // Sort reverse by position
    uniqueEdits.sort((a, b) => b.start - a.start);

    let text = originalSources.get(fileName);
    if (text === undefined) continue;

    for (const edit of uniqueEdits) {
      text = text.slice(0, edit.start) + edit.newText + text.slice(edit.start + edit.length);
    }
    outputFiles.set(fileName, text);
  }

  // Include files with no edits (copy as-is) — only project source files
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || sf.fileName.includes('node_modules')) continue;
    if (!outputFiles.has(sf.fileName)) {
      outputFiles.set(sf.fileName, sf.getFullText());
    }
  }

  return { outputFiles, errors };
}
