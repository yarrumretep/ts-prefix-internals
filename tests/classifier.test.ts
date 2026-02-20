import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createProgramFromConfig } from '../src/program.js';
import { discoverPublicApiSurface } from '../src/api-surface.js';
import { classifySymbols } from '../src/classifier.js';

const TEST_PROJECT = path.resolve(import.meta.dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(import.meta.dirname, '../test-project/src/index.ts');

describe('classifier', () => {
  function getClassification() {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);
    return classifySymbols(program, checker, publicSymbols, [TEST_ENTRY], '_');
  }

  it('marks internal class as prefix', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    expect(prefixNames).toContain('DependencyGraph');
  });

  it('marks private members of public class as prefix', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    expect(prefixNames).toContain('CalculationEngine.graph');
    expect(prefixNames).toContain('CalculationEngine.dirtySet');
    expect(prefixNames).toContain('CalculationEngine.valueCache');
    expect(prefixNames).toContain('CalculationEngine.addressToKey');
    expect(prefixNames).toContain('CalculationEngine.markDirty');
    expect(prefixNames).toContain('CalculationEngine.recalculate');
  });

  it('marks internal functions as prefix', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    expect(prefixNames).toContain('hashKey');
    expect(prefixNames).toContain('parseKey');
  });

  it('marks all members of internal class as prefix', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    expect(prefixNames).toContain('DependencyGraph.adjacency');
    expect(prefixNames).toContain('DependencyGraph.reverseAdjacency');
    expect(prefixNames).toContain('DependencyGraph.addDependency');
    expect(prefixNames).toContain('DependencyGraph.getDependents');
    expect(prefixNames).toContain('DependencyGraph.getDependencies');
    expect(prefixNames).toContain('DependencyGraph.hasCycle');
  });

  it('does NOT mark public class as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('CalculationEngine');
  });

  it('does NOT mark public methods as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('CalculationEngine.setCellValue');
    expect(noPrefixNames).toContain('CalculationEngine.getCellValue');
  });

  it('does NOT mark exported interfaces as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('CellAddress');
    expect(noPrefixNames).toContain('CellRange');
    expect(noPrefixNames).toContain('CellType');
  });

  it('does NOT mark exported interface members as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('CellAddress.sheet');
    expect(noPrefixNames).toContain('CellAddress.row');
    expect(noPrefixNames).toContain('CellAddress.col');
  });

  it('does NOT mark exported enum members as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('CellType.Number');
    expect(noPrefixNames).toContain('CellType.Text');
    expect(noPrefixNames).toContain('CellType.Formula');
  });
});
