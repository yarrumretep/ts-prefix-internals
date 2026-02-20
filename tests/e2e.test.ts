import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { prefixInternals, FullResult } from '../src/index.js';

const TEST_PROJECT = path.resolve(import.meta.dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(import.meta.dirname, '../test-project/src/index.ts');

describe('end-to-end', () => {
  let outDir: string;
  let result: FullResult;

  beforeAll(async () => {
    outDir = path.join(os.tmpdir(), 'ts-prefix-e2e-' + Date.now());
    result = await prefixInternals({
      projectPath: TEST_PROJECT,
      entryPoints: [TEST_ENTRY],
      outDir,
      prefix: '_',
      dryRun: false,
      verbose: false,
      skipValidation: false,
    });
  });

  afterAll(() => {
    if (outDir && fs.existsSync(outDir)) {
      fs.rmSync(outDir, { recursive: true });
    }
  });

  it('produces no validation errors', () => {
    expect(result.validationErrors).toBeUndefined();
  });

  it('prefixes all expected internal symbols', () => {
    const prefixed = new Set(result.willPrefix.map(d => d.qualifiedName));

    // Internal class
    expect(prefixed.has('LinkMap')).toBe(true);
    expect(prefixed.has('LinkMap.forward')).toBe(true);
    expect(prefixed.has('LinkMap.reverse')).toBe(true);
    expect(prefixed.has('LinkMap.connect')).toBe(true);
    expect(prefixed.has('LinkMap.followers')).toBe(true);
    expect(prefixed.has('LinkMap.targets')).toBe(true);
    expect(prefixed.has('LinkMap.hasLoop')).toBe(true);

    // Private members of public class
    expect(prefixed.has('Processor.links')).toBe(true);
    expect(prefixed.has('Processor.pending')).toBe(true);
    expect(prefixed.has('Processor.cache')).toBe(true);
    expect(prefixed.has('Processor.toKey')).toBe(true);
    expect(prefixed.has('Processor.mark')).toBe(true);
    expect(prefixed.has('Processor.refresh')).toBe(true);

    // Internal functions
    expect(prefixed.has('makeKey')).toBe(true);
    expect(prefixed.has('splitKey')).toBe(true);
    expect(prefixed.has('summarizeShape')).toBe(true);

    // Internal type alias + members
    expect(prefixed.has('InternalShape')).toBe(true);
    expect(prefixed.has('InternalShape.count')).toBe(true);
    expect(prefixed.has('InternalShape.label')).toBe(true);
  });

  it('does not prefix any public API symbols', () => {
    const notPrefixed = new Set(result.willNotPrefix.map(d => d.qualifiedName));

    expect(notPrefixed.has('Processor')).toBe(true);
    expect(notPrefixed.has('Processor.setEntry')).toBe(true);
    expect(notPrefixed.has('Processor.getEntry')).toBe(true);
    expect(notPrefixed.has('Coord')).toBe(true);
    expect(notPrefixed.has('CoordRange')).toBe(true);
    expect(notPrefixed.has('CoordKind')).toBe(true);
  });

  it('output engine.ts has correct renames', () => {
    const engineContent = fs.readFileSync(path.join(outDir, 'src', 'engine.ts'), 'utf-8');

    // Public class name preserved
    expect(engineContent).toContain('class Processor');

    // Private members prefixed
    expect(engineContent).toContain('this._links');
    expect(engineContent).toContain('this._pending');
    expect(engineContent).toContain('this._cache');
    expect(engineContent).toContain('_toKey');
    expect(engineContent).toContain('_mark');
    expect(engineContent).toContain('_refresh');

    // Internal class reference prefixed
    expect(engineContent).toContain('_LinkMap');

    // Public methods preserved
    expect(engineContent).toContain('setEntry');
    expect(engineContent).toContain('getEntry');
  });

  it('output graph.ts has fully prefixed class', () => {
    const graphContent = fs.readFileSync(path.join(outDir, 'src', 'graph.ts'), 'utf-8');

    expect(graphContent).toContain('class _LinkMap');
    expect(graphContent).toContain('_forward');
    expect(graphContent).toContain('_reverse');
    expect(graphContent).toContain('_connect');
    expect(graphContent).toContain('_followers');
    expect(graphContent).toContain('_targets');
    expect(graphContent).toContain('_hasLoop');
  });

  it('output types.ts is unchanged (all public)', () => {
    const typesOriginal = fs.readFileSync(
      path.resolve(import.meta.dirname, '../test-project/src/types.ts'), 'utf-8'
    );
    const typesOutput = fs.readFileSync(path.join(outDir, 'src', 'types.ts'), 'utf-8');
    expect(typesOutput).toBe(typesOriginal);
  });

  it('output aliases.ts prefixes internal type alias members', () => {
    const aliasesContent = fs.readFileSync(path.join(outDir, 'src', 'aliases.ts'), 'utf-8');
    expect(aliasesContent).toContain('type _InternalShape');
    expect(aliasesContent).toContain('_count: number');
    expect(aliasesContent).toContain('_label: string');
    expect(aliasesContent).toContain('const { _count: count, _label: label } = arg');
  });
});
