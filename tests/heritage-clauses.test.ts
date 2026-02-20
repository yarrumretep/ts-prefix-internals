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

describe('heritage clause resolution', () => {
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

  describe('class extends (CalculationEngine extends BaseEngine)', () => {
    it('discovers base class as public via heritage clause', () => {
      const names = getPublicNames();
      // BaseEngine is not exported from barrel, but CalculationEngine extends it
      expect(names.has('BaseEngine')).toBe(true);
    });

    it('discovers interface implemented by base class as public', () => {
      const names = getPublicNames();
      // BaseEngine implements Serializable, so Serializable is public too
      expect(names.has('Serializable')).toBe(true);
    });

    it('discovers public members of base class as public', () => {
      const names = getPublicNames();
      // BaseEngine.serialize() is public, inherited by CalculationEngine
      expect(names.has('serialize')).toBe(true);
      // BaseEngine.engineId is protected, visible to subclass consumers
      expect(names.has('engineId')).toBe(true);
    });

    it('does NOT prefix base class since it leaks through heritage', () => {
      const result = getClassification();
      const prefixNames = result.willPrefix.map(d => d.qualifiedName);
      expect(prefixNames).not.toContain('BaseEngine');
    });

    it('does NOT prefix Serializable.serialize since it leaks through heritage', () => {
      const result = getClassification();
      const prefixNames = result.willPrefix.map(d => d.qualifiedName);
      expect(prefixNames).not.toContain('Serializable');
      expect(prefixNames).not.toContain('Serializable.serialize');
    });
  });

  describe('interface extends (CellAddress extends Identifiable)', () => {
    it('discovers base interface as public via heritage clause', () => {
      const names = getPublicNames();
      // Identifiable is not exported from barrel, but CellAddress extends it
      expect(names.has('Identifiable')).toBe(true);
    });

    it('discovers base interface members as public', () => {
      const names = getPublicNames();
      // Identifiable.id should be public since CellAddress inherits it
      expect(names.has('id')).toBe(true);
    });

    it('does NOT prefix base interface or its members', () => {
      const result = getClassification();
      const prefixNames = result.willPrefix.map(d => d.qualifiedName);
      expect(prefixNames).not.toContain('Identifiable');
      expect(prefixNames).not.toContain('Identifiable.id');
    });
  });

  describe('output compiles after heritage-aware renaming', () => {
    it('produces valid TypeScript with heritage chains intact', async () => {
      const outDir = path.join(os.tmpdir(), 'ts-prefix-heritage-' + Date.now());
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

      // engine.ts should still reference BaseEngine (not _BaseEngine)
      const engineContent = fs.readFileSync(path.join(outDir, 'src', 'engine.ts'), 'utf-8');
      expect(engineContent).toContain('extends BaseEngine');
      expect(engineContent).not.toContain('extends _BaseEngine');

      fs.rmSync(outDir, { recursive: true, force: true });
    });
  });
});
