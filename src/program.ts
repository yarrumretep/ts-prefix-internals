import ts from 'typescript';
import path from 'node:path';

export function createProgramFromConfig(tsconfigPath: string): ts.Program {
  const absolutePath = path.resolve(tsconfigPath);
  const configFile = ts.readConfigFile(absolutePath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`);
  }

  const basePath = path.dirname(absolutePath);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, basePath);
  if (parsed.errors.length > 0) {
    const messages = parsed.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    throw new Error(`tsconfig parse errors:\n${messages.join('\n')}`);
  }

  return ts.createProgram(parsed.fileNames, parsed.options);
}

class InMemoryLanguageServiceHost implements ts.LanguageServiceHost {
  private files: Map<string, { content: string; version: number }>;
  private options: ts.CompilerOptions;
  private fileNames: string[];

  constructor(program: ts.Program) {
    this.options = program.getCompilerOptions();
    this.files = new Map();
    this.fileNames = [];

    for (const sf of program.getSourceFiles()) {
      this.files.set(sf.fileName, { content: sf.getFullText(), version: 0 });
      this.fileNames.push(sf.fileName);
    }
  }

  getCompilationSettings = () => this.options;
  getScriptFileNames = () => this.fileNames;
  getScriptVersion = (fileName: string) => String(this.files.get(fileName)?.version ?? 0);
  getScriptSnapshot = (fileName: string) => {
    const file = this.files.get(fileName);
    return file ? ts.ScriptSnapshot.fromString(file.content) : undefined;
  };
  getCurrentDirectory = () => ts.sys.getCurrentDirectory();
  getDefaultLibFileName = (options: ts.CompilerOptions) => ts.getDefaultLibFilePath(options);
  fileExists = ts.sys.fileExists;
  readFile = ts.sys.readFile;
  readDirectory = ts.sys.readDirectory;
  directoryExists = ts.sys.directoryExists;
  getDirectories = ts.sys.getDirectories;
}

export function createLanguageService(program: ts.Program): ts.LanguageService {
  const host = new InMemoryLanguageServiceHost(program);
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}
