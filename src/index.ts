import ts from 'typescript';
import path from 'node:path';
import fs from 'node:fs';
import { PrefixConfig, PrefixResult, RenameDecision } from './config.js';
import { createProgramFromConfig, createLanguageService } from './program.js';
import { discoverPublicApiSurface } from './api-surface.js';
import { classifySymbols } from './classifier.js';
import { computeRenames } from './renamer.js';

export { type PrefixConfig, type PrefixResult, type RenameDecision, parseArgs } from './config.js';

export interface FullResult extends PrefixResult {
  validationErrors?: string[];
}

export async function prefixInternals(config: PrefixConfig): Promise<FullResult> {
  const { projectPath, entryPoints, outDir, prefix, dryRun, skipValidation } = config;

  // 1. Create TypeScript program
  const program = createProgramFromConfig(projectPath);
  const checker = program.getTypeChecker();

  // 2. Discover public API surface
  const publicApiSymbols = discoverPublicApiSurface(program, checker, entryPoints);

  // 3. Classify symbols
  const classification = classifySymbols(program, checker, publicApiSymbols, entryPoints, prefix);

  if (dryRun) {
    return {
      willPrefix: classification.willPrefix,
      willNotPrefix: classification.willNotPrefix,
      warnings: classification.warnings,
      outputFiles: new Map(),
    };
  }

  // 4. Compute renames
  const ls = createLanguageService(program);
  const renameResult = computeRenames(ls, program, classification.symbolsToRename, publicApiSymbols);
  const warnings = [...classification.warnings, ...renameResult.errors];

  // 5. Write output files
  const projectDir = path.dirname(path.resolve(projectPath));
  const absoluteOutDir = path.resolve(outDir);

  fs.mkdirSync(absoluteOutDir, { recursive: true });

  for (const [fileName, content] of renameResult.outputFiles) {
    const outPath = resolveOutputPath(projectDir, absoluteOutDir, fileName);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content);
  }

  // Copy tsconfig.json to output
  const tsconfigContent = fs.readFileSync(path.resolve(projectPath), 'utf-8');
  const tsconfigOutPath = path.join(absoluteOutDir, 'tsconfig.json');
  fs.writeFileSync(tsconfigOutPath, tsconfigContent);

  // 6. Validate output compiles
  let validationErrors: string[] | undefined;
  if (!skipValidation) {
    validationErrors = validateOutput(tsconfigOutPath);
    if (validationErrors.length === 0) {
      validationErrors = undefined;
    }
  }

  return {
    willPrefix: classification.willPrefix,
    willNotPrefix: classification.willNotPrefix,
    warnings,
    outputFiles: renameResult.outputFiles,
    validationErrors,
  };
}

function resolveOutputPath(projectDir: string, outDir: string, sourceFileName: string): string {
  const relativePath = path.relative(projectDir, sourceFileName);

  let safeRelativePath = relativePath;
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    const normalized = path.normalize(sourceFileName);
    const strippedRoot = normalized.replace(/^([A-Za-z]:)?[\\/]+/, '').replace(/:/g, '_');
    const safeSegments = strippedRoot
      .split(/[\\/]/)
      .filter(seg => seg.length > 0 && seg !== '.' && seg !== '..');
    safeRelativePath = path.join('__external__', ...safeSegments);
  }

  const outputPath = path.resolve(outDir, safeRelativePath);
  const outRoot = path.resolve(outDir) + path.sep;
  if (outputPath !== path.resolve(outDir) && !outputPath.startsWith(outRoot)) {
    throw new Error(`Refusing to write outside outDir: ${sourceFileName}`);
  }
  return outputPath;
}

function validateOutput(tsconfigPath: string): string[] {
  const program = createProgramFromConfig(tsconfigPath);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  return diagnostics.map(d => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    if (d.file && d.start !== undefined) {
      const { line } = d.file.getLineAndCharacterOfPosition(d.start);
      return `${path.relative(process.cwd(), d.file.fileName)}:${line + 1}: ${msg}`;
    }
    return msg;
  });
}
