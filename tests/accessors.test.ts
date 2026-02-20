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
    it('discovers PresenterConfig as public because Presenter.config getter returns it', () => {
      const names = getPublicNames();
      // PresenterConfig is not exported from barrel, but Presenter (which IS exported)
      // has a getter that returns it — so it leaks through the public API
      expect(names.has('PresenterConfig')).toBe(true);
    });

    it('discovers PresenterConfig members as public', () => {
      const names = getPublicNames();
      expect(names.has('enabled')).toBe(true);
      expect(names.has('strict')).toBe(true);
    });

    it('does NOT prefix PresenterConfig or its members', () => {
      const result = getClassification();
      const prefixNames = result.willPrefix.map(d => d.qualifiedName);
      expect(prefixNames).not.toContain('PresenterConfig');
      expect(prefixNames).not.toContain('PresenterConfig.enabled');
      expect(prefixNames).not.toContain('PresenterConfig.strict');
    });

    it('DOES prefix Presenter.current (private member)', () => {
      const result = getClassification();
      const prefixNames = result.willPrefix.map(d => d.qualifiedName);
      expect(prefixNames).toContain('Presenter.current');
    });
  });

  describe('constructor parameter types', () => {
    it('discovers PresenterConfig via constructor parameter type on Presenter', () => {
      // The Presenter constructor takes PresenterConfig as a parameter type.
      // Even without the getter, the constructor parameter type should make it public.
      const names = getPublicNames();
      expect(names.has('PresenterConfig')).toBe(true);
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

      // accessors.ts should preserve PresenterConfig references
      const accessorsContent = fs.readFileSync(path.join(outDir, 'src', 'accessors.ts'), 'utf-8');
      expect(accessorsContent).toContain('PresenterConfig');
      expect(accessorsContent).not.toContain('_PresenterConfig');

      // Private member should be prefixed
      expect(accessorsContent).toContain('_current');

      fs.rmSync(outDir, { recursive: true, force: true });
    });
  });
});
