import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createProgramFromConfig } from '../src/program.js';
import { discoverPublicApiSurface } from '../src/api-surface.js';
import { classifySymbols } from '../src/classifier.js';
import { prefixInternals } from '../src/index.js';

const TEST_PROJECT = path.resolve(import.meta.dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(import.meta.dirname, '../test-project/src/index.ts');

describe('getter/setter and constructor parameter type discovery', () => {
  function getPublicNames() {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);
    const names = new Set<string>();
    for (const sym of publicSymbols) {
      names.add(sym.getName());
    }
    return names;
  }

  function getClassification() {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);
    return classifySymbols(program, checker, publicSymbols, [TEST_ENTRY], '_');
  }

  describe('getter/setter type references', () => {
    it('discovers FormatOptions as public because Formatter.options getter returns it', () => {
      const names = getPublicNames();
      // FormatOptions is not exported from barrel, but Formatter (which IS exported)
      // has a getter that returns it — so it leaks through the public API
      expect(names.has('FormatOptions')).toBe(true);
    });

    it('discovers FormatOptions members as public', () => {
      const names = getPublicNames();
      expect(names.has('uppercase')).toBe(true);
      expect(names.has('trimWhitespace')).toBe(true);
    });

    it('does NOT prefix FormatOptions or its members', () => {
      const result = getClassification();
      const prefixNames = result.willPrefix.map(d => d.qualifiedName);
      expect(prefixNames).not.toContain('FormatOptions');
      expect(prefixNames).not.toContain('FormatOptions.uppercase');
      expect(prefixNames).not.toContain('FormatOptions.trimWhitespace');
    });

    it('DOES prefix Formatter.currentOptions (private member)', () => {
      const result = getClassification();
      const prefixNames = result.willPrefix.map(d => d.qualifiedName);
      expect(prefixNames).toContain('Formatter.currentOptions');
    });
  });

  describe('constructor parameter types', () => {
    it('discovers FormatOptions via constructor parameter type on Formatter', () => {
      // The Formatter constructor takes FormatOptions as a parameter type.
      // Even without the getter, the constructor parameter type should make it public.
      const names = getPublicNames();
      expect(names.has('FormatOptions')).toBe(true);
    });
  });

  describe('output compiles with accessor types resolved', () => {
    it('produces valid TypeScript', async () => {
      const outDir = path.join(os.tmpdir(), 'ts-prefix-accessors-' + Date.now());
      const result = await prefixInternals({
        projectPath: TEST_PROJECT,
        entryPoints: [TEST_ENTRY],
        outDir,
        prefix: '_',
        dryRun: false,
        verbose: false,
        skipValidation: false,
      });

      expect(result.validationErrors).toBeUndefined();

      // accessors.ts should preserve FormatOptions references
      const accessorsContent = fs.readFileSync(path.join(outDir, 'src', 'accessors.ts'), 'utf-8');
      expect(accessorsContent).toContain('FormatOptions');
      expect(accessorsContent).not.toContain('_FormatOptions');

      // Private member should be prefixed
      expect(accessorsContent).toContain('_currentOptions');

      fs.rmSync(outDir, { recursive: true, force: true });
    });
  });
});
