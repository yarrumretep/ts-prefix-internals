import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createProgramFromConfig, createLanguageService } from '../src/program.js';
import { discoverPublicApiSurface } from '../src/api-surface.js';
import { classifySymbols } from '../src/classifier.js';
import { computeRenames } from '../src/renamer.js';

const TEST_PROJECT = path.resolve(import.meta.dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(import.meta.dirname, '../test-project/src/index.ts');

describe('renamer', () => {
  function getRenames() {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);
    const classification = classifySymbols(program, checker, publicSymbols, [TEST_ENTRY], '_');
    const ls = createLanguageService(program);
    return computeRenames(ls, program, classification.symbolsToRename);
  }

  it('produces output files', () => {
    const result = getRenames();
    expect(result.outputFiles.size).toBeGreaterThan(0);
  });

  it('prefixes LinkMap class name', () => {
    const result = getRenames();
    const graphFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('graph.ts'));
    expect(graphFile).toBeDefined();
    const [, content] = graphFile!;
    expect(content).toContain('class _LinkMap');
    expect(content).not.toMatch(/class LinkMap\b/);
  });

  it('prefixes private members of Processor', () => {
    const result = getRenames();
    const engineFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('engine.ts'));
    expect(engineFile).toBeDefined();
    const [, content] = engineFile!;
    expect(content).toContain('_links');
    expect(content).toContain('_pending');
    expect(content).toContain('_cache');
    expect(content).toContain('_toKey');
    expect(content).toContain('_mark');
    expect(content).toContain('_refresh');
  });

  it('does NOT prefix public methods of Processor', () => {
    const result = getRenames();
    const engineFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('engine.ts'));
    expect(engineFile).toBeDefined();
    const [, content] = engineFile!;
    expect(content).toContain('setEntry');
    expect(content).toContain('getEntry');
    expect(content).not.toContain('_setEntry');
    expect(content).not.toContain('_getEntry');
  });

  it('does NOT modify exported interface members', () => {
    const result = getRenames();
    const typesFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('types.ts'));
    expect(typesFile).toBeDefined();
    const [, content] = typesFile!;
    expect(content).toContain('ns:');
    expect(content).toContain('x:');
    expect(content).toContain('y:');
    expect(content).not.toContain('_ns');
    expect(content).not.toContain('_x');
    expect(content).not.toContain('_y');
  });

  it('updates import of LinkMap in engine.ts', () => {
    const result = getRenames();
    const engineFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('engine.ts'));
    expect(engineFile).toBeDefined();
    const [, content] = engineFile!;
    expect(content).toContain('_LinkMap');
  });

  it('prefixes internal utility functions', () => {
    const result = getRenames();
    const utilsFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('utils.ts'));
    expect(utilsFile).toBeDefined();
    const [, content] = utilsFile!;
    expect(content).toContain('function _makeKey');
    expect(content).toContain('function _splitKey');
  });

  it('expands shorthand properties when property is prefixed but local variable is not', () => {
    const result = getRenames();
    const builderFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('builder.ts'));
    expect(builderFile).toBeDefined();
    const [, content] = builderFile!;

    // The return statement `return { graph, nodeCount }` must expand to
    // `return { _graph: graph, _nodeCount: nodeCount }` because the interface
    // properties are prefixed but the local variables keep their original names.
    expect(content).toContain('_graph: graph');
    expect(content).toContain('_nodeCount: nodeCount');

    // The local variable declarations should NOT be prefixed
    expect(content).toMatch(/const graph = new _LinkMap/);
    expect(content).toMatch(/const nodeCount = pairs\.length/);
  });

  it('expands shorthand destructuring when property is prefixed but binding is not', () => {
    const result = getRenames();
    const builderFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('builder.ts'));
    expect(builderFile).toBeDefined();
    const [, content] = builderFile!;

    // `const { nodeCount } = createGraphSetup(...)` should expand to
    // `const { _nodeCount: nodeCount } = ...` so the local binding keeps its name.
    expect(content).toContain('_nodeCount: nodeCount');
  });

  it('renames property accesses through anonymous inline type casts', () => {
    const result = getRenames();
    const builderFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('builder.ts'));
    expect(builderFile).toBeDefined();
    const [, content] = builderFile!;

    // `(result as { nodeCount: number }).nodeCount` must become
    // `(result as { _nodeCount: number })._nodeCount` — both the type
    // annotation AND the property access must be renamed, even though
    // findRenameLocations doesn't link anonymous type properties to
    // the named interface.
    expect(content).toContain('as { _nodeCount: number })._nodeCount');
    // The original unprefixed form should not remain
    expect(content).not.toMatch(/as \{ nodeCount:/);
  });
});
