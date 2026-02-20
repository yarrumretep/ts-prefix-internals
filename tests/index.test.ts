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

  it('writes files outside projectDir under outDir/__external__', async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-prefix-path-'));
    const projectDir = path.join(baseDir, 'project');
    const sharedDir = path.join(baseDir, 'shared');
    const outDir = path.join(projectDir, 'out');

    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.mkdirSync(sharedDir, { recursive: true });

    const tsconfigPath = path.join(projectDir, 'tsconfig.json');
    const entryPath = path.join(projectDir, 'src', 'index.ts');
    const sharedPath = path.join(sharedDir, 'internal.ts');

    fs.writeFileSync(tsconfigPath, JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
      },
      files: ['src/index.ts', '../shared/internal.ts'],
    }, null, 2));

    fs.writeFileSync(entryPath, "export { api } from '../../shared/internal.js';\n");
    fs.writeFileSync(sharedPath, "export function api(): number { return helper(); }\nfunction helper(): number { return 1; }\n");

    const originalShared = fs.readFileSync(sharedPath, 'utf-8');

    await prefixInternals({
      projectPath: tsconfigPath,
      entryPoints: [entryPath],
      outDir,
      prefix: '_',
      dryRun: false,
      verbose: false,
      skipValidation: true,
    });

    // Original source outside projectDir should not be rewritten in-place.
    expect(fs.readFileSync(sharedPath, 'utf-8')).toBe(originalShared);

    const externalRoot = path.join(outDir, '__external__');
    expect(fs.existsSync(externalRoot)).toBe(true);

    function findFirstFile(dir: string, fileName: string): string | undefined {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const nested = findFirstFile(fullPath, fileName);
          if (nested) return nested;
        } else if (entry.isFile() && entry.name === fileName) {
          return fullPath;
        }
      }
      return undefined;
    }

    const externalInternalFile = findFirstFile(externalRoot, 'internal.ts');
    expect(externalInternalFile).toBeDefined();
    expect(fs.readFileSync(externalInternalFile!, 'utf-8')).toContain('function _helper');

    fs.rmSync(baseDir, { recursive: true, force: true });
  });
});
