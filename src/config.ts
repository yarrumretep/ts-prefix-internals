export interface PrefixConfig {
  projectPath: string;
  entryPoints: string[];
  outDir: string;
  prefix: string;
  dryRun: boolean;
  verbose: boolean;
  skipValidation: boolean;
}

export const DEFAULT_PREFIX = '_';

export interface RenameDecision {
  symbolName: string;
  qualifiedName: string;
  kind: string;
  fileName: string;
  line: number;
  newName: string;
  reason: string;
}

export interface PrefixResult {
  willPrefix: RenameDecision[];
  willNotPrefix: RenameDecision[];
  warnings: string[];
  outputFiles: Map<string, string>;
}
