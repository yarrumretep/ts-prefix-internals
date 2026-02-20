import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createProgramFromConfig } from '../src/program.js';
import { discoverPublicApiSurface } from '../src/api-surface.js';

const TEST_PROJECT = path.resolve(import.meta.dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(import.meta.dirname, '../test-project/src/index.ts');

describe('api-surface', () => {
  it('discovers all public symbols from barrel export', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);

    const names = new Set<string>();
    for (const sym of publicSymbols) {
      names.add(sym.getName());
    }

    // Directly exported symbols
    expect(names.has('CalculationEngine')).toBe(true);
    expect(names.has('CellAddress')).toBe(true);
    expect(names.has('CellRange')).toBe(true);
    expect(names.has('CellType')).toBe(true);

    // NOT exported from barrel
    expect(names.has('DependencyGraph')).toBe(false);
    expect(names.has('hashKey')).toBe(false);
    expect(names.has('parseKey')).toBe(false);
  });

  it('includes public members of exported classes', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);

    const names = new Set<string>();
    for (const sym of publicSymbols) {
      names.add(sym.getName());
    }

    expect(names.has('setCellValue')).toBe(true);
    expect(names.has('getCellValue')).toBe(true);

    expect(names.has('addressToKey')).toBe(false);
    expect(names.has('markDirty')).toBe(false);
    expect(names.has('recalculate')).toBe(false);
  });

  it('includes members of exported interfaces', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);

    const names = new Set<string>();
    for (const sym of publicSymbols) {
      names.add(sym.getName());
    }

    expect(names.has('sheet')).toBe(true);
    expect(names.has('row')).toBe(true);
    expect(names.has('col')).toBe(true);
    expect(names.has('start')).toBe(true);
    expect(names.has('end')).toBe(true);
  });

  it('includes members of exported enums', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);

    const names = new Set<string>();
    for (const sym of publicSymbols) {
      names.add(sym.getName());
    }

    expect(names.has('Number')).toBe(true);
    expect(names.has('Text')).toBe(true);
    expect(names.has('Formula')).toBe(true);
  });
});
