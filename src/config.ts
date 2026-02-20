import path from 'node:path';

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

export function parseArgs(args: string[]): PrefixConfig {
  let projectPath = '';
  const entryPoints: string[] = [];
  let outDir = '';
  let prefix = DEFAULT_PREFIX;
  let dryRun = false;
  let verbose = false;
  let skipValidation = false;

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
  -h, --help                Show this help message

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

export interface PrefixResult {
  willPrefix: RenameDecision[];
  willNotPrefix: RenameDecision[];
  warnings: string[];
  outputFiles: Map<string, string>;
}
