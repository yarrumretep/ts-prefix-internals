import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { createProgramFromConfig } from '../src/program.js';
import { discoverPublicApiSurface } from '../src/api-surface.js';
import { classifySymbols } from '../src/classifier.js';
import type { Diagnostic } from '../src/config.js';

const TEST_PROJECT = path.resolve(import.meta.dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(import.meta.dirname, '../test-project/src/index.ts');

describe('dynamic access diagnostics', () => {
  let allDiagnostics: Diagnostic[];

  beforeAll(() => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);
    const result = classifySymbols(program, checker, publicSymbols, [TEST_ENTRY], '_');
    allDiagnostics = result.diagnostics;
  });

  function diagnosticsForFile(fileName: string): Diagnostic[] {
    return allDiagnostics.filter(d => d.file.endsWith(fileName));
  }

  describe('silent tier — array/tuple/string-index access', () => {
    it('does NOT emit diagnostics for array index or string-index access', () => {
      const diags = diagnosticsForFile('dynamic-access.ts');
      // Only the error (g[field] with literal type) should appear;
      // array indexing is silent (array type), obj[key] is silent (string index type)
      expect(diags).toHaveLength(1);
    });
  });

  describe('error tier — string literal type matching prefixed property', () => {
    it('emits error for access with literal type matching renamed symbol', () => {
      const diags = diagnosticsForFile('dynamic-access.ts');
      const errors = diags.filter(d => d.level === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('forward');
      expect(errors[0].message).toContain('reverse');
    });
  });

  describe('existing test-project files', () => {
    it('does NOT emit diagnostics for files with no dynamic access', () => {
      const engineDiags = diagnosticsForFile('engine.ts');
      expect(engineDiags).toHaveLength(0);
    });
  });

  describe('unsafe patterns', () => {
    it('warns about destructured parameter with defaults matching renamed names', () => {
      const diags = diagnosticsForFile('unsafe-patterns.ts');
      const paramDefault = diags.filter(d => d.message.includes('Destructured parameter with default'));
      expect(paramDefault).toHaveLength(1);
      expect(paramDefault[0].message).toContain('forward');
      expect(paramDefault[0].level).toBe('warn');
    });

    it('warns about destructured binding of anonymous type', () => {
      const diags = diagnosticsForFile('unsafe-patterns.ts');
      const binding = diags.filter(d => d.message.includes('Destructured binding'));
      expect(binding).toHaveLength(1);
      expect(binding[0].message).toContain('forward');
      expect(binding[0].level).toBe('warn');
    });

    it('warns about computed property key with renamed names', () => {
      const diags = diagnosticsForFile('unsafe-patterns.ts');
      const computed = diags.filter(d => d.message.includes('Computed property key'));
      expect(computed).toHaveLength(1);
      expect(computed[0].message).toContain('forward');
      expect(computed[0].level).toBe('warn');
    });

    it('does NOT warn about patterns with // ts-prefix-suppress-warnings on the preceding line', () => {
      const diags = diagnosticsForFile('unsafe-patterns.ts');
      // Only the 3 un-suppressed patterns should emit warnings; the 2 suppressed ones should not
      expect(diags).toHaveLength(3);
    });
  });
});
