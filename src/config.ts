import path from 'node:path';

export interface PrefixConfig {
  projectPath: string;
  entryPoints: string[];
  outDir: string;
  prefix: string;
  dryRun: boolean;
  verbose: boolean;
  skipValidation: boolean;
  force: boolean;
  strict: boolean;
}

export const DEFAULT_PREFIX = '_';

export function parseArgs(args: string[]): PrefixConfig {
  let projectPath = '';
  const entryPoints: string[] = [];
  let outDir = '';
  let prefix = DEFAULT_PREFIX;
  let dryRun = false;
  let verbose = false;
  let skipValidation = false;
  let force = false;
  let strict = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        console.log(`Usage: ts-prefix-internals [options]

Options:
  -p, --project <path>      Path to tsconfig.json (required)
  -e, --entry <file>        Public API entry point file(s), repeatable (required)
  -o, --outDir <dir>        Output directory for rewritten files (required)
      --prefix <string>     Prefix string (default: "_")
      --dry-run             Report what would be renamed without writing files
      --verbose             Print every rename decision with reasoning
      --skip-validation     Skip post-rename type-check
      --force               Continue despite dynamic-access errors (exit 0)
      --strict              Treat warnings as errors (fail on unsafe patterns)
  -h, --help                Show this help message

Suppression:
  // ts-prefix-suppress-warnings           suppress warning on the next line
  // ts-prefix-suppress-warnings-start ... // ts-prefix-suppress-warnings-end   suppress a block

Example:
  ts-prefix-internals -p tsconfig.json -e src/index.ts -o .mangled --dry-run`);
        process.exit(0);
      case '--project':
      case '-p':
        projectPath = args[++i];
        break;
      case '--entry':
      case '-e':
        entryPoints.push(args[++i]);
        break;
      case '--outDir':
      case '-o':
        outDir = args[++i];
        break;
      case '--prefix':
        prefix = args[++i];
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--verbose':
        verbose = true;
        break;
      case '--skip-validation':
        skipValidation = true;
        break;
      case '--force':
        force = true;
        break;
      case '--strict':
        strict = true;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  if (!projectPath) throw new Error('--project / -p is required');
  if (entryPoints.length === 0) throw new Error('--entry / -e is required (at least one)');
  if (!outDir) throw new Error('--outDir / -o is required');

  return {
    projectPath: path.resolve(projectPath),
    entryPoints: entryPoints.map(e => path.resolve(e)),
    outDir: path.resolve(outDir),
    prefix,
    dryRun,
    verbose,
    skipValidation,
    force,
    strict,
  };
}

export interface RenameDecision {
  symbolName: string;
  qualifiedName: string;
  kind: string;
  fileName: string;
  line: number;
  newName: string;
  reason: string;
}

export interface Diagnostic {
  level: 'error' | 'warn';
  message: string;
  file: string;
  line: number;
}

export interface PrefixResult {
  willPrefix: RenameDecision[];
  willNotPrefix: RenameDecision[];
  diagnostics: Diagnostic[];
  outputFiles: Map<string, string>;
}
