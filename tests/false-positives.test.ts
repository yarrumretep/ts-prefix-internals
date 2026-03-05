import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { createProgramFromConfig } from '../src/program.js';
import { discoverPublicApiSurface } from '../src/api-surface.js';
import { classifySymbols } from '../src/classifier.js';
import type { Diagnostic } from '../src/config.js';

const TEST_PROJECT = path.resolve(import.meta.dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(import.meta.dirname, '../test-project/src/index.ts');

describe('dynamic access false positives', () => {
  let diags: Diagnostic[];

  beforeAll(() => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);
    const result = classifySymbols(program, checker, publicSymbols, [TEST_ENTRY], '_');
    diags = result.diagnostics.filter(d =>
      d.file.endsWith('dynamic-access-false-positives.ts'),
    );
  });

  // -----------------------------------------------------------------------
  // False positive 1: String index types (Record<string, T>, { [k: string]: T })
  // -----------------------------------------------------------------------

  it('does not warn on Record<string, unknown> element access', () => {
    expect(diags.filter(d => d.line === 12)).toHaveLength(0);
  });

  it('does not warn on for...in iteration over Record', () => {
    expect(diags.filter(d => d.line === 19)).toHaveLength(0);
  });

  it('does not warn on Object.entries key used as index into Record', () => {
    expect(diags.filter(d => d.line === 28)).toHaveLength(0);
  });

  it('does not warn on explicit string index signature', () => {
    expect(diags.filter(d => d.line === 38)).toHaveLength(0);
  });

  it('does not warn on Record<string, string> constant lookup', () => {
    expect(diags.filter(d => d.line === 86)).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // False positive 2: Optional-chained array access
  // -----------------------------------------------------------------------

  it('does not warn on array access through optional chain (literal index)', () => {
    expect(diags.filter(d => d.line === 54)).toHaveLength(0);
  });

  it('does not warn on nested optional chain with array access', () => {
    expect(diags.filter(d => d.line === 62)).toHaveLength(0);
  });

  it('does not warn on optional-chained array with variable index', () => {
    expect(diags.filter(d => d.line === 67)).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // False positive 3: Generic type parameters
  // -----------------------------------------------------------------------

  it('does not warn on generic overlay (for...in on Partial<T>)', () => {
    // Line 100: target[key] = source[key]! — T and Partial<T>
    expect(diags.filter(d => d.line === 100)).toHaveLength(0);
  });

  it('does not warn on generic key iteration', () => {
    // Line 107: obj[key] — T extends object
    expect(diags.filter(d => d.line === 107)).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Control: this SHOULD still warn
  // -----------------------------------------------------------------------

  it('still warns on genuinely unsafe dynamic access (as any)', () => {
    // Line 118: (g as any)[key]
    const controlDiags = diags.filter(d => d.line === 118);
    expect(controlDiags).toHaveLength(1);
    expect(controlDiags[0].level).toBe('warn');
  });

  it('emits exactly one diagnostic total (only the control case)', () => {
    expect(diags).toHaveLength(1);
  });
});
