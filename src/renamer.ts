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
