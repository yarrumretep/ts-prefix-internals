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
  program: ts.Program,
  symbolsToRename: Map<ts.Symbol, string>,
  publicApiSymbols?: Set<ts.Symbol>
): RenameResult {
  const allEdits: PendingEdit[] = [];
  const errors: string[] = [];
  const checker = program.getTypeChecker();

  // Collect original source texts
  const originalSources = new Map<string, string>();
  for (const sf of program.getSourceFiles()) {
    originalSources.set(sf.fileName, sf.getFullText());
  }

  // Alias-aware rename lookup (full resolution — for general identifiers)
  function getNewName(symbol: ts.Symbol): string | undefined {
    const direct = symbolsToRename.get(symbol);
    if (direct !== undefined) return direct;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      // If alias was created by an import/export specifier with an `as` clause,
      // the local name is decoupled from the imported name — don't follow the chain.
      // e.g., `import { buildModel as buildModelImpl }` — buildModelImpl references
      // should NOT be renamed even though buildModel is being renamed.
      const decl = symbol.declarations?.[0];
      if (decl && (ts.isImportSpecifier(decl) || ts.isExportSpecifier(decl)) && decl.propertyName) {
        return undefined;
      }
      try { return symbolsToRename.get(checker.getAliasedSymbol(symbol)); }
      catch { return undefined; }
    }
    return undefined;
  }

  // Chain-aware rename lookup for import/export specifiers.
  // Walks the alias chain one level at a time and STOPS if it encounters
  // an ExportSpecifier with a `propertyName` (i.e., an `as` clause).
  // This prevents renaming `import { ChatPane }` when the barrel has
  // `export { default as ChatPane }` — the `ChatPane` name was explicitly
  // chosen and shouldn't change even though the underlying value is renamed.
  function getNewNameForImportOrExport(symbol: ts.Symbol): string | undefined {
    const direct = symbolsToRename.get(symbol);
    if (direct !== undefined) return direct;

    let current: ts.Symbol | undefined = symbol;
    while (current && current.flags & ts.SymbolFlags.Alias) {
      const decl = current.declarations?.[0];
      // Stop at export specifiers with `as` — the name was explicitly chosen
      if (decl && ts.isExportSpecifier(decl) && decl.propertyName) {
        return undefined;
      }
      try {
        current = checker.getImmediateAliasedSymbol(current);
      } catch {
        return undefined;
      }
      if (current) {
        const newName = symbolsToRename.get(current);
        if (newName !== undefined) return newName;
      }
    }

    return undefined;
  }

  function isPublicApiSymbol(symbol: ts.Symbol): boolean {
    if (!publicApiSymbols) return false;
    if (publicApiSymbols.has(symbol)) return true;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      try {
        return publicApiSymbols.has(checker.getAliasedSymbol(symbol));
      } catch {
        return false;
      }
    }
    return false;
  }

  // Build lookup: original property name → new name
  const renamedPropNames = new Map<string, string>();
  const renamedPropertySymbols = new Set<ts.Symbol>();
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
      ts.isEnumMember(d) ||
      ts.isMethodDeclaration(d) ||
      ts.isMethodSignature(d)
    );
    if (isProperty) {
      renamedPropNames.set(symbol.getName(), newName);
      renamedPropertySymbols.add(symbol);
    }
  }

  // Build set of positions already covered
  const editedPositions = new Set<string>();

  // Helper: rename all declarations of a property symbol that haven't been
  // edited yet (e.g. inline anonymous type literals)
  function renamePropertyDeclarations(prop: ts.Symbol, propName: string, newName: string): void {
    if (isPublicApiSymbol(prop)) return;
    const propDecls = prop.getDeclarations();
    if (!propDecls) return;
    for (const d of propDecls) {
      const declSf = d.getSourceFile();
      if (declSf.isDeclarationFile || declSf.fileName.includes('node_modules')) continue;
      const declName = (ts.isPropertySignature(d) || ts.isPropertyDeclaration(d) || ts.isMethodSignature(d) || ts.isMethodDeclaration(d))
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

  // Helper: find a property on a type, searching union members if needed.
  function getPropertyFromType(type: ts.Type, propName: string): ts.Symbol | undefined {
    const prop = type.getProperty(propName);
    if (prop) return prop;
    if (type.isUnion()) {
      for (const member of type.types) {
        const memberProp = member.getProperty(propName);
        if (memberProp) return memberProp;
      }
    }
    return undefined;
  }

  // Helper: check if a property is declared in project source (not lib/node_modules)
  function isProjectProperty(prop: ts.Symbol): boolean {
    const propDecls = prop.getDeclarations();
    return propDecls?.some(d => {
      const dsf = d.getSourceFile();
      return !dsf.isDeclarationFile && !dsf.fileName.includes('node_modules');
    }) ?? false;
  }

  // Resolve the source object type for object binding patterns like:
  // `const { x } = expr` or `function f({ x }: T)`.
  function getBindingSourceType(node: ts.BindingElement): ts.Type | undefined {
    const pattern = node.parent;
    if (!ts.isObjectBindingPattern(pattern)) return undefined;

    const container = pattern.parent;

    if (ts.isVariableDeclaration(container) && container.initializer) {
      return checker.getTypeAtLocation(container.initializer);
    }

    if (ts.isParameter(container)) {
      if (container.type) {
        return checker.getTypeFromTypeNode(container.type);
      }
      const symbol = checker.getSymbolAtLocation(container.name);
      if (symbol) {
        return checker.getTypeOfSymbolAtLocation(symbol, container);
      }
    }

    return undefined;
  }

  // Resolve the source object type for object literals used either as:
  // - regular object literals with contextual typing: f({ x: 1 })
  // - destructuring assignment targets: ({ x } = expr)
  function getObjectLiteralSourceType(objLit: ts.ObjectLiteralExpression): ts.Type | undefined {
    const contextualType = checker.getContextualType(objLit);
    if (contextualType) return contextualType;

    const parent = objLit.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      parent.left === objLit
    ) {
      return checker.getTypeAtLocation(parent.right);
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Single-pass AST walk — replaces the per-symbol findRenameLocations loop
  // and both fallback AST walks (anonymous types and destructuring).
  // ---------------------------------------------------------------------------
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || sf.fileName.includes('node_modules')) continue;

    const visit = (node: ts.Node): void => {

      // --- Case A: Property access expressions — obj.prop ---
      if (ts.isPropertyAccessExpression(node)) {
        const nameNode = node.name;
        const propName = nameNode.text;
        const pos = nameNode.getStart();
        const key = `${sf.fileName}:${pos}`;

        if (!editedPositions.has(key)) {
          // Try direct symbol lookup first
          const sym = checker.getSymbolAtLocation(nameNode);
          const directNewName = sym ? getNewName(sym) : undefined;

          if (directNewName !== undefined) {
            allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: directNewName });
            editedPositions.add(key);
          } else {
            // Fallback: name-based lookup via type resolution (catches anonymous types)
            const newName = renamedPropNames.get(propName);
            if (newName !== undefined) {
              const type = checker.getTypeAtLocation(node.expression);
              const prop = getPropertyFromType(type, propName);
              if (prop && isProjectProperty(prop) && !isPublicApiSymbol(prop)) {
                allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: newName });
                editedPositions.add(key);
                renamePropertyDeclarations(prop, propName, newName);
              }
            }
          }
        }

        // Visit the expression subtree but not the name (already handled)
        visit(node.expression);
        return;
      }

      // --- Case B: Property assignment — { key: value } ---
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
        const propName = node.name.text;
        const pos = node.name.getStart();
        const key = `${sf.fileName}:${pos}`;

        if (!editedPositions.has(key)) {
          // Try direct symbol lookup first
          const sym = checker.getSymbolAtLocation(node.name);
          const directNewName = sym ? getNewName(sym) : undefined;

          if (directNewName !== undefined) {
            allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: directNewName });
            editedPositions.add(key);
          } else {
            // Fallback: contextual type resolution
            const newName = renamedPropNames.get(propName);
            if (newName !== undefined) {
              const objLit = node.parent;
              if (ts.isObjectLiteralExpression(objLit)) {
                const sourceType = getObjectLiteralSourceType(objLit);
                if (sourceType) {
                  const prop = getPropertyFromType(sourceType, propName);
                  if (prop && isProjectProperty(prop) && !isPublicApiSymbol(prop)) {
                    allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: newName });
                    editedPositions.add(key);
                    renamePropertyDeclarations(prop, propName, newName);
                  }
                }
              }
            }
          }
        }

        // Visit the initializer but skip the name
        if (node.initializer) visit(node.initializer);
        return;
      }

      // --- Case C: Shorthand property — { key } ---
      if (ts.isShorthandPropertyAssignment(node)) {
        const propName = node.name.text;
        const pos = node.name.getStart();
        const key = `${sf.fileName}:${pos}`;

        if (!editedPositions.has(key)) {
          // Check property side (via contextual type)
          let propNewName: string | undefined;
          const objLit = node.parent;
          if (ts.isObjectLiteralExpression(objLit)) {
            const sourceType = getObjectLiteralSourceType(objLit);
            if (sourceType) {
              const prop = getPropertyFromType(sourceType, propName);
              if (prop) {
                const pName = getNewName(prop);
                if (pName !== undefined) {
                  propNewName = pName;
                } else if (renamedPropNames.has(propName) && isProjectProperty(prop) && !isPublicApiSymbol(prop)) {
                  propNewName = renamedPropNames.get(propName);
                }
              }
            }
          }

          // Check value side (the local variable reference)
          let valueNewName: string | undefined;
          const valueSym = checker.getShorthandAssignmentValueSymbol(node);
          if (valueSym) {
            valueNewName = getNewName(valueSym);
          }

          if (propNewName !== undefined || valueNewName !== undefined) {
            const finalProp = propNewName ?? propName;
            const finalValue = valueNewName ?? propName;

            if (finalProp === finalValue) {
              // Both sides have the same name — keep shorthand form
              allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: finalProp });
            } else {
              // Expand shorthand
              allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: `${finalProp}: ${finalValue}` });
            }
            editedPositions.add(key);

            // Rename anonymous property declarations if using fallback
            if (propNewName !== undefined && ts.isObjectLiteralExpression(objLit)) {
              const sourceType = getObjectLiteralSourceType(objLit);
              if (sourceType) {
                const prop = getPropertyFromType(sourceType, propName);
                if (prop) renamePropertyDeclarations(prop, propName, propNewName);
              }
            }
          }
        }

        // No children to visit for shorthand
        return;
      }

      // --- Case D: Binding element in object destructuring ---
      if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
        const hasExplicitPropName = node.propertyName && ts.isIdentifier(node.propertyName);
        const propName = hasExplicitPropName
          ? (node.propertyName as ts.Identifier).text
          : ts.isIdentifier(node.name)
            ? node.name.text
            : undefined;

        if (propName !== undefined) {
          // Check if the property needs renaming
          let propNewName: string | undefined;
          const sourceType = getBindingSourceType(node);
          if (sourceType) {
            const prop = getPropertyFromType(sourceType, propName);
            if (prop) {
              propNewName = getNewName(prop);
              if (!propNewName && renamedPropNames.has(propName) && isProjectProperty(prop) && !isPublicApiSymbol(prop)) {
                if (renamedPropertySymbols.has(prop)) {
                  propNewName = renamedPropNames.get(propName);
                }
              }
            }
          }

          if (propNewName !== undefined) {
            if (hasExplicitPropName) {
              // Has explicit propertyName — rename just that
              const propNameNode = node.propertyName as ts.Identifier;
              const pos = propNameNode.getStart();
              const key = `${sf.fileName}:${pos}`;
              if (!editedPositions.has(key)) {
                allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: propNewName });
                editedPositions.add(key);
              }
            } else if (ts.isIdentifier(node.name)) {
              // No explicit propertyName — check if binding name is also renamed
              const bindSym = checker.getSymbolAtLocation(node.name);
              const bindNewName = bindSym ? getNewName(bindSym) : undefined;

              const finalProp = propNewName;
              const finalBind = bindNewName ?? node.name.text;

              const pos = node.name.getStart();
              const key = `${sf.fileName}:${pos}`;
              if (!editedPositions.has(key)) {
                if (finalProp === finalBind) {
                  // Both sides same — keep shorthand
                  allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: finalProp });
                } else {
                  // Expand: { x } → { _x: x }
                  allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: `${finalProp}: ${finalBind}` });
                }
                editedPositions.add(key);
              }
            }

            if (sourceType) {
              const prop = getPropertyFromType(sourceType, propName);
              if (prop) renamePropertyDeclarations(prop, propName, propNewName);
            }
          } else if (!hasExplicitPropName && ts.isIdentifier(node.name)) {
            // Property NOT renamed, but check if local binding IS renamed
            const bindSym = checker.getSymbolAtLocation(node.name);
            const bindNewName = bindSym ? getNewName(bindSym) : undefined;
            if (bindNewName !== undefined) {
              const pos = node.name.getStart();
              const key = `${sf.fileName}:${pos}`;
              if (!editedPositions.has(key)) {
                // Expand: { x } → { x: _x }
                allEdits.push({ fileName: sf.fileName, start: pos, length: node.name.text.length, newText: `${propName}: ${bindNewName}` });
                editedPositions.add(key);
              }
            }
          }
        }

        // Also handle the binding name itself when there IS an explicit propertyName
        if (hasExplicitPropName && ts.isIdentifier(node.name)) {
          const bindSym = checker.getSymbolAtLocation(node.name);
          if (bindSym) {
            const bindNewName = getNewName(bindSym);
            if (bindNewName !== undefined) {
              const pos = node.name.getStart();
              const key = `${sf.fileName}:${pos}`;
              if (!editedPositions.has(key)) {
                allEdits.push({ fileName: sf.fileName, start: pos, length: node.name.text.length, newText: bindNewName });
                editedPositions.add(key);
              }
            }
          }
        }

        // Visit initializer if present
        if (node.initializer) visit(node.initializer);
        // Visit nested binding patterns
        if (!ts.isIdentifier(node.name)) visit(node.name);
        return;
      }

      // --- Case E: Element access with string literal — obj["prop"] ---
      if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) {
        const propName = node.argumentExpression.text;
        const newName = renamedPropNames.get(propName);
        if (newName !== undefined) {
          const type = checker.getTypeAtLocation(node.expression);
          const prop = getPropertyFromType(type, propName);
          if (prop && isProjectProperty(prop) && !isPublicApiSymbol(prop)) {
            const pos = node.argumentExpression.getStart() + 1; // skip opening quote
            const key = `${sf.fileName}:${pos}`;
            if (!editedPositions.has(key)) {
              allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: newName });
              editedPositions.add(key);
            }
          }
        }
        // Fall through to visit children
      }

      // --- Case E2: Indexed access type — Type['prop'] ---
      if (ts.isIndexedAccessTypeNode(node) && ts.isLiteralTypeNode(node.indexType) && ts.isStringLiteral(node.indexType.literal)) {
        const propName = node.indexType.literal.text;
        const newName = renamedPropNames.get(propName);
        if (newName !== undefined) {
          const objectType = checker.getTypeFromTypeNode(node.objectType);
          const prop = getPropertyFromType(objectType, propName);
          if (prop && isProjectProperty(prop) && !isPublicApiSymbol(prop)) {
            const pos = node.indexType.literal.getStart() + 1; // skip opening quote
            const key = `${sf.fileName}:${pos}`;
            if (!editedPositions.has(key)) {
              allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: newName });
              editedPositions.add(key);
            }
          }
        }
        // Fall through to visit children
      }

      // --- Case E3: Method declaration in object literal — { method() {} } ---
      if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && ts.isObjectLiteralExpression(node.parent)) {
        const propName = node.name.text;
        const pos = node.name.getStart();
        const key = `${sf.fileName}:${pos}`;

        if (!editedPositions.has(key)) {
          // Try direct symbol lookup first
          const sym = checker.getSymbolAtLocation(node.name);
          const directNewName = sym ? getNewName(sym) : undefined;

          if (directNewName !== undefined) {
            allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: directNewName });
            editedPositions.add(key);
          } else {
            // Fallback: contextual type resolution
            const newName = renamedPropNames.get(propName);
            if (newName !== undefined) {
              const objLit = node.parent;
              const sourceType = getObjectLiteralSourceType(objLit);
              if (sourceType) {
                const prop = getPropertyFromType(sourceType, propName);
                if (prop && isProjectProperty(prop) && !isPublicApiSymbol(prop)) {
                  allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: newName });
                  editedPositions.add(key);
                  renamePropertyDeclarations(prop, propName, newName);
                }
              }
            }
          }
        }

        // Visit children (parameters, type, body) but skip the name
        node.parameters.forEach(p => visit(p));
        if (node.type) visit(node.type);
        if (node.body) ts.forEachChild(node.body, visit);
        return;
      }

      // --- Case E4: JSX attribute — <Component propName={value} /> ---
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)) {
        const propName = node.name.text;
        const pos = node.name.getStart();
        const key = `${sf.fileName}:${pos}`;

        if (!editedPositions.has(key)) {
          // Try direct symbol lookup first
          const sym = checker.getSymbolAtLocation(node.name);
          const directNewName = sym ? getNewName(sym) : undefined;

          if (directNewName !== undefined) {
            allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: directNewName });
            editedPositions.add(key);
          } else {
            // Fallback: name-based lookup via component props type
            const newName = renamedPropNames.get(propName);
            if (newName !== undefined) {
              const jsxElement = node.parent?.parent; // JsxAttributes → JsxOpeningElement/JsxSelfClosingElement
              if (jsxElement && (ts.isJsxOpeningElement(jsxElement) || ts.isJsxSelfClosingElement(jsxElement))) {
                const propsType = checker.getContextualType(node.parent as ts.Expression) ??
                  ((): ts.Type | undefined => {
                    const tagSym = checker.getSymbolAtLocation(jsxElement.tagName);
                    if (!tagSym) return undefined;
                    const tagType = checker.getTypeOfSymbolAtLocation(tagSym, jsxElement);
                    const callSigs = tagType.getCallSignatures();
                    if (callSigs.length > 0) return callSigs[0].getParameters()[0]
                      ? checker.getTypeOfSymbolAtLocation(callSigs[0].getParameters()[0], jsxElement)
                      : undefined;
                    return undefined;
                  })();
                if (propsType) {
                  const prop = getPropertyFromType(propsType, propName);
                  if (prop && isProjectProperty(prop) && !isPublicApiSymbol(prop)) {
                    allEdits.push({ fileName: sf.fileName, start: pos, length: propName.length, newText: newName });
                    editedPositions.add(key);
                  }
                }
              }
            }
          }
        }

        // Visit initializer but skip the name
        if (node.initializer) visit(node.initializer);
        return;
      }

      // --- Case F: Generic identifiers ---
      if (ts.isIdentifier(node)) {
        const parent = node.parent;

        // Skip identifiers already handled by parent-node cases above
        if (ts.isPropertyAccessExpression(parent) && node === parent.name) return;
        if (ts.isPropertyAssignment(parent) && node === parent.name) return;
        if (ts.isShorthandPropertyAssignment(parent) && node === parent.name) return;
        if (ts.isBindingElement(parent) && (node === parent.propertyName || node === parent.name)) return;
        if (ts.isJsxAttribute(parent) && node === parent.name) return;

        // Skip `default` keyword used as propertyName in import/export specifiers
        // — it refers to the module's default export and can't be renamed
        if (
          (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) &&
          node === parent.propertyName &&
          node.text === 'default'
        ) return;

        const sym = checker.getSymbolAtLocation(node);
        if (!sym) return;

        const pos = node.getStart();
        const key = `${sf.fileName}:${pos}`;
        if (editedPositions.has(key)) return;

        let newName: string | undefined;

        // Aliased import/export specifier local names: only direct lookup
        // to avoid incorrectly renaming `B` in `import { A as B }` or `export { A as B }`
        if (
          ((ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) &&
            node === parent.name && parent.propertyName)
        ) {
          newName = symbolsToRename.get(sym);
        }
        // Import/export specifier identifiers: chain-aware resolution
        // that stops at `as` boundaries to prevent renaming through re-exports
        else if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
          newName = getNewNameForImportOrExport(sym);
        }
        // Regular identifiers: full alias resolution
        else {
          newName = getNewName(sym);
        }

        if (newName !== undefined) {
          allEdits.push({ fileName: sf.fileName, start: pos, length: node.text.length, newText: newName });
          editedPositions.add(key);
        }
        return;
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
