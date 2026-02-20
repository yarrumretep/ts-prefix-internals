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

  it('prefixes DependencyGraph class name', () => {
    const result = getRenames();
    const graphFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('graph.ts'));
    expect(graphFile).toBeDefined();
    const [, content] = graphFile!;
    expect(content).toContain('class _DependencyGraph');
    expect(content).not.toMatch(/class DependencyGraph\b/);
  });

  it('prefixes private members of CalculationEngine', () => {
    const result = getRenames();
    const engineFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('engine.ts'));
    expect(engineFile).toBeDefined();
    const [, content] = engineFile!;
    expect(content).toContain('_graph');
    expect(content).toContain('_dirtySet');
    expect(content).toContain('_valueCache');
    expect(content).toContain('_addressToKey');
    expect(content).toContain('_markDirty');
    expect(content).toContain('_recalculate');
  });

  it('does NOT prefix public methods of CalculationEngine', () => {
    const result = getRenames();
    const engineFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('engine.ts'));
    expect(engineFile).toBeDefined();
    const [, content] = engineFile!;
    expect(content).toContain('setCellValue');
    expect(content).toContain('getCellValue');
    expect(content).not.toContain('_setCellValue');
    expect(content).not.toContain('_getCellValue');
  });

  it('does NOT modify exported interface members', () => {
    const result = getRenames();
    const typesFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('types.ts'));
    expect(typesFile).toBeDefined();
    const [, content] = typesFile!;
    expect(content).toContain('sheet:');
    expect(content).toContain('row:');
    expect(content).toContain('col:');
    expect(content).not.toContain('_sheet');
    expect(content).not.toContain('_row');
    expect(content).not.toContain('_col');
  });

  it('updates import of DependencyGraph in engine.ts', () => {
    const result = getRenames();
    const engineFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('engine.ts'));
    expect(engineFile).toBeDefined();
    const [, content] = engineFile!;
    expect(content).toContain('_DependencyGraph');
  });

  it('prefixes internal utility functions', () => {
    const result = getRenames();
    const utilsFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('utils.ts'));
    expect(utilsFile).toBeDefined();
    const [, content] = utilsFile!;
    expect(content).toContain('function _hashKey');
    expect(content).toContain('function _parseKey');
  });
});
