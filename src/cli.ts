#!/usr/bin/env node
import { parseArgs, RenameDecision, Diagnostic } from './config.js';
import { prefixInternals } from './index.js';

function formatDryRun(willPrefix: RenameDecision[], willNotPrefix: RenameDecision[], diagnostics: Diagnostic[]): string {
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

  const errors = diagnostics.filter(d => d.level === 'error');
  const warns = diagnostics.filter(d => d.level === 'warn');

  if (errors.length > 0) {
    lines.push('');
    lines.push(`ERRORS (${errors.length}):`);
    for (const e of errors) {
      lines.push(`  ${e.message}`);
    }
  }

  if (warns.length > 0) {
    lines.push('');
    lines.push(`WARNINGS (${warns.length}):`);
    for (const w of warns) {
      lines.push(`  ${w.message}`);
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
      console.log(formatDryRun(result.willPrefix, result.willNotPrefix, result.diagnostics));
      const errors = result.diagnostics.filter(d => d.level === 'error');
      if (errors.length > 0 && !config.force) {
        process.exit(1);
      }
    } else {
      console.log(`Prefixed ${result.willPrefix.length} symbols.`);
      console.log(`Skipped ${result.willNotPrefix.length} public API symbols.`);

      const errors = result.diagnostics.filter(d => d.level === 'error');
      const warns = result.diagnostics.filter(d => d.level === 'warn');

      if (errors.length > 0) {
        console.error(`\nErrors (${errors.length}):`);
        for (const e of errors) {
          console.error(`  ${e.message}`);
        }
      }
      if (warns.length > 0) {
        console.log(`\nWarnings (${warns.length}):`);
        for (const w of warns) {
          console.log(`  ${w.message}`);
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

      if (errors.length > 0 && !config.force) {
        console.error('\nDynamic access errors detected. Use --force to proceed anyway.');
        process.exit(1);
      }

      console.log(`\nOutput written to: ${config.outDir}`);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
