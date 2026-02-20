import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/config.js';

describe('parseArgs', () => {
  it('parses required args', () => {
    const config = parseArgs([
      '--project', 'tsconfig.json',
      '--entry', 'src/index.ts',
      '--outDir', 'dist',
    ]);
    expect(config.projectPath).toContain('tsconfig.json');
    expect(config.entryPoints.length).toBe(1);
    expect(config.entryPoints[0]).toContain('index.ts');
    expect(config.outDir).toContain('dist');
    expect(config.prefix).toBe('_');
    expect(config.dryRun).toBe(false);
    expect(config.verbose).toBe(false);
    expect(config.skipValidation).toBe(false);
  });

  it('parses short flags', () => {
    const config = parseArgs([
      '-p', 'tsconfig.json',
      '-e', 'src/index.ts',
      '-o', 'dist',
    ]);
    expect(config.projectPath).toContain('tsconfig.json');
    expect(config.entryPoints.length).toBe(1);
    expect(config.outDir).toContain('dist');
  });

  it('parses multiple entry points', () => {
    const config = parseArgs([
      '-p', 'tsconfig.json',
      '-e', 'src/index.ts',
      '-e', 'src/other.ts',
      '-o', 'dist',
    ]);
    expect(config.entryPoints.length).toBe(2);
  });

  it('parses optional flags', () => {
    const config = parseArgs([
      '-p', 'tsconfig.json',
      '-e', 'src/index.ts',
      '-o', 'dist',
      '--prefix', '__',
      '--dry-run',
      '--verbose',
      '--skip-validation',
    ]);
    expect(config.prefix).toBe('__');
    expect(config.dryRun).toBe(true);
    expect(config.verbose).toBe(true);
    expect(config.skipValidation).toBe(true);
  });

  it('throws on missing required args', () => {
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(['-p', 'tsconfig.json'])).toThrow();
  });
});
