import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { prefixInternals } from '../src/index.js';

const TEST_PROJECT = path.resolve(import.meta.dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(import.meta.dirname, '../test-project/src/index.ts');

describe('prefixInternals', () => {
  it('dry run reports correct decisions', async () => {
    const result = await prefixInternals({
      projectPath: TEST_PROJECT,
      entryPoints: [TEST_ENTRY],
      outDir: path.join(os.tmpdir(), 'ts-prefix-test-' + Date.now()),
      prefix: '_',
      dryRun: true,
      verbose: false,
      skipValidation: true,
    });

    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);

    expect(prefixNames).toContain('LinkMap');
    expect(prefixNames).toContain('makeKey');
    expect(prefixNames).toContain('splitKey');
    expect(prefixNames).toContain('Processor.links');

    expect(noPrefixNames).toContain('Processor');
    expect(noPrefixNames).toContain('Processor.setEntry');
    expect(noPrefixNames).toContain('Coord');
  });

  it('writes output files that compile', async () => {
    const outDir = path.join(os.tmpdir(), 'ts-prefix-test-' + Date.now());
    const result = await prefixInternals({
      projectPath: TEST_PROJECT,
      entryPoints: [TEST_ENTRY],
      outDir,
      prefix: '_',
      dryRun: false,
      verbose: false,
      skipValidation: false,
    });

    expect(fs.existsSync(path.join(outDir, 'src', 'engine.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'src', 'graph.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'tsconfig.json'))).toBe(true);

    expect(result.validationErrors).toBeUndefined();

    // Cleanup
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
