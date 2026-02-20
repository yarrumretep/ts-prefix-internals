#!/usr/bin/env node
import path from 'node:path';
import { PrefixConfig, DEFAULT_PREFIX, RenameDecision } from './config.js';
import { prefixInternals, FullResult } from './index.js';

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

function formatDryRun(willPrefix: RenameDecision[], willNotPrefix: RenameDecision[], warnings: string[]): string {
  const lines: string[] = [];

  lines.push('WILL PREFIX (internal):');
  for (const d of willPrefix) {
    const pad = Math.max(1, 40 - d.qualifiedName.length);
    lines.push(`  ${d.qualifiedName}${' '.repeat(pad)}${d.kind.padEnd(12)} ${d.fileName}:${d.line}    \u2192 ${d.newName}`);
  }

  lines.push('');
  lines.push('WILL NOT PREFIX (public API):');
  for (const d of willNotPrefix) {
    const pad = Math.max(1, 40 - d.qualifiedName.length);
    lines.push(`  ${d.qualifiedName}${' '.repeat(pad)}${d.kind.padEnd(12)} ${d.fileName}:${d.line}    (${d.reason})`);
  }

  if (warnings.length > 0) {
    lines.push('');
    lines.push('WARNINGS:');
    for (const w of warnings) {
      lines.push(`  ${w}`);
    }
  }

  return lines.join('\n');
}

async function main() {
  try {
    const config = parseArgs(process.argv.slice(2));

    if (config.verbose) {
      console.log('Configuration:', JSON.stringify(config, null, 2));
    }

    const result = await prefixInternals(config);

    if (config.dryRun) {
      console.log(formatDryRun(result.willPrefix, result.willNotPrefix, result.warnings));
    } else {
      console.log(`Prefixed ${result.willPrefix.length} symbols.`);
      console.log(`Skipped ${result.willNotPrefix.length} public API symbols.`);
      if (result.warnings.length > 0) {
        console.log(`\nWarnings (${result.warnings.length}):`);
        for (const w of result.warnings) {
          console.log(`  ${w}`);
        }
      }
      if (result.validationErrors) {
        console.error(`\nValidation errors (${result.validationErrors.length}):`);
        for (const e of result.validationErrors) {
          console.error(`  ${e}`);
        }
        process.exit(1);
      } else if (!config.skipValidation) {
        console.log('\nOutput compiles successfully.');
      }
      console.log(`\nOutput written to: ${config.outDir}`);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

// Only run main when executed directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/cli.js') ||
  process.argv[1].endsWith('/cli.ts')
);
if (isDirectRun) {
  main();
}
