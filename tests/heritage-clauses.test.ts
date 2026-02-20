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

  describe('class extends (Processor extends BaseProcessor)', () => {
    it('discovers base class as public via heritage clause', () => {
      const names = getPublicNames();
      // BaseProcessor is not exported from barrel, but Processor extends it
      expect(names.has('BaseProcessor')).toBe(true);
    });

    it('discovers interface implemented by base class as public', () => {
      const names = getPublicNames();
      // BaseProcessor implements Stringable, so Stringable is public too
      expect(names.has('Stringable')).toBe(true);
    });

    it('discovers public members of base class as public', () => {
      const names = getPublicNames();
      // BaseProcessor.stringify() is public, inherited by Processor
      expect(names.has('stringify')).toBe(true);
      // BaseProcessor.instanceId is protected, visible to subclass consumers
      expect(names.has('instanceId')).toBe(true);
    });

    it('does NOT prefix base class since it leaks through heritage', () => {
      const result = getClassification();
      const prefixNames = result.willPrefix.map(d => d.qualifiedName);
      expect(prefixNames).not.toContain('BaseProcessor');
    });

    it('does NOT prefix Stringable.stringify since it leaks through heritage', () => {
      const result = getClassification();
      const prefixNames = result.willPrefix.map(d => d.qualifiedName);
      expect(prefixNames).not.toContain('Stringable');
      expect(prefixNames).not.toContain('Stringable.stringify');
    });
  });

  describe('interface extends (Coord extends Taggable)', () => {
    it('discovers base interface as public via heritage clause', () => {
      const names = getPublicNames();
      // Taggable is not exported from barrel, but Coord extends it
      expect(names.has('Taggable')).toBe(true);
    });

    it('discovers base interface members as public', () => {
      const names = getPublicNames();
      // Taggable.tag should be public since Coord inherits it
      expect(names.has('tag')).toBe(true);
    });

    it('does NOT prefix base interface or its members', () => {
      const result = getClassification();
      const prefixNames = result.willPrefix.map(d => d.qualifiedName);
      expect(prefixNames).not.toContain('Taggable');
      expect(prefixNames).not.toContain('Taggable.tag');
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

      // engine.ts should still reference BaseProcessor (not _BaseProcessor)
      const engineContent = fs.readFileSync(path.join(outDir, 'src', 'engine.ts'), 'utf-8');
      expect(engineContent).toContain('extends BaseProcessor');
      expect(engineContent).not.toContain('extends _BaseProcessor');

      fs.rmSync(outDir, { recursive: true, force: true });
    });
  });
});
