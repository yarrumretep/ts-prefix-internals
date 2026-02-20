#!/usr/bin/env node
import { parseArgs, RenameDecision } from './config.js';
import { prefixInternals } from './index.js';

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

main();
