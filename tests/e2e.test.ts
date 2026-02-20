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
    expect(prefixed.has('DependencyGraph')).toBe(true);
    expect(prefixed.has('DependencyGraph.adjacency')).toBe(true);
    expect(prefixed.has('DependencyGraph.reverseAdjacency')).toBe(true);
    expect(prefixed.has('DependencyGraph.addDependency')).toBe(true);
    expect(prefixed.has('DependencyGraph.getDependents')).toBe(true);
    expect(prefixed.has('DependencyGraph.getDependencies')).toBe(true);
    expect(prefixed.has('DependencyGraph.hasCycle')).toBe(true);

    // Private members of public class
    expect(prefixed.has('CalculationEngine.graph')).toBe(true);
    expect(prefixed.has('CalculationEngine.dirtySet')).toBe(true);
    expect(prefixed.has('CalculationEngine.valueCache')).toBe(true);
    expect(prefixed.has('CalculationEngine.addressToKey')).toBe(true);
    expect(prefixed.has('CalculationEngine.markDirty')).toBe(true);
    expect(prefixed.has('CalculationEngine.recalculate')).toBe(true);

    // Internal functions
    expect(prefixed.has('hashKey')).toBe(true);
    expect(prefixed.has('parseKey')).toBe(true);
  });

  it('does not prefix any public API symbols', () => {
    const notPrefixed = new Set(result.willNotPrefix.map(d => d.qualifiedName));

    expect(notPrefixed.has('CalculationEngine')).toBe(true);
    expect(notPrefixed.has('CalculationEngine.setCellValue')).toBe(true);
    expect(notPrefixed.has('CalculationEngine.getCellValue')).toBe(true);
    expect(notPrefixed.has('CellAddress')).toBe(true);
    expect(notPrefixed.has('CellRange')).toBe(true);
    expect(notPrefixed.has('CellType')).toBe(true);
  });

  it('output engine.ts has correct renames', () => {
    const engineContent = fs.readFileSync(path.join(outDir, 'src', 'engine.ts'), 'utf-8');

    // Public class name preserved
    expect(engineContent).toContain('class CalculationEngine');

    // Private members prefixed
    expect(engineContent).toContain('this._graph');
    expect(engineContent).toContain('this._dirtySet');
    expect(engineContent).toContain('this._valueCache');
    expect(engineContent).toContain('_addressToKey');
    expect(engineContent).toContain('_markDirty');
    expect(engineContent).toContain('_recalculate');

    // Internal class reference prefixed
    expect(engineContent).toContain('_DependencyGraph');

    // Public methods preserved
    expect(engineContent).toContain('setCellValue');
    expect(engineContent).toContain('getCellValue');
  });

  it('output graph.ts has fully prefixed class', () => {
    const graphContent = fs.readFileSync(path.join(outDir, 'src', 'graph.ts'), 'utf-8');

    expect(graphContent).toContain('class _DependencyGraph');
    expect(graphContent).toContain('_adjacency');
    expect(graphContent).toContain('_reverseAdjacency');
    expect(graphContent).toContain('_addDependency');
    expect(graphContent).toContain('_getDependents');
    expect(graphContent).toContain('_getDependencies');
    expect(graphContent).toContain('_hasCycle');
  });

  it('output types.ts is unchanged (all public)', () => {
    const typesOriginal = fs.readFileSync(
      path.resolve(import.meta.dirname, '../test-project/src/types.ts'), 'utf-8'
    );
    const typesOutput = fs.readFileSync(path.join(outDir, 'src', 'types.ts'), 'utf-8');
    expect(typesOutput).toBe(typesOriginal);
  });
});
