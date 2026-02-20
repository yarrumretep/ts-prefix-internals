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
    expect(names.has('Processor')).toBe(true);
    expect(names.has('Coord')).toBe(true);
    expect(names.has('CoordRange')).toBe(true);
    expect(names.has('CoordKind')).toBe(true);

    // NOT exported from barrel
    expect(names.has('LinkMap')).toBe(false);
    expect(names.has('makeKey')).toBe(false);
    expect(names.has('splitKey')).toBe(false);
  });

  it('includes public members of exported classes', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);

    const names = new Set<string>();
    for (const sym of publicSymbols) {
      names.add(sym.getName());
    }

    expect(names.has('setEntry')).toBe(true);
    expect(names.has('getEntry')).toBe(true);

    expect(names.has('toKey')).toBe(false);
    expect(names.has('mark')).toBe(false);
    expect(names.has('refresh')).toBe(false);
  });

  it('includes members of exported interfaces', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);

    const names = new Set<string>();
    for (const sym of publicSymbols) {
      names.add(sym.getName());
    }

    expect(names.has('ns')).toBe(true);
    expect(names.has('x')).toBe(true);
    expect(names.has('y')).toBe(true);
    expect(names.has('from')).toBe(true);
    expect(names.has('to')).toBe(true);
  });

  it('includes members of exported enums', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);

    const names = new Set<string>();
    for (const sym of publicSymbols) {
      names.add(sym.getName());
    }

    expect(names.has('Alpha')).toBe(true);
    expect(names.has('Beta')).toBe(true);
    expect(names.has('Gamma')).toBe(true);
  });
});
