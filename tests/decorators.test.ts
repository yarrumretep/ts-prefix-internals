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

describe('decorator handling', () => {
  function getClassification() {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);
    return classifySymbols(program, checker, publicSymbols, [TEST_ENTRY], '_');
  }

  it('does NOT prefix a class decorated with @sealed', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    // DecoratedHandler is internal (not exported from barrel) but has @sealed decorator
    // Decorated symbols must not be prefixed because decorators may rely on name reflection
    expect(prefixNames).not.toContain('DecoratedHandler');
  });

  it('does NOT prefix a method decorated with @log', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    // handle has @log decorator — renaming it would break the decorator's reflection
    expect(prefixNames).not.toContain('DecoratedHandler.handle');
  });

  it('DOES prefix non-decorated members of a decorated class', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    // hidden is a private field with no decorator — should be prefixed
    expect(prefixNames).toContain('DecoratedHandler.hidden');
    // helperMethod has no decorator — should be prefixed
    expect(prefixNames).toContain('DecoratedHandler.helperMethod');
  });

  it('output compiles with decorated symbols left intact', async () => {
    const outDir = path.join(os.tmpdir(), 'ts-prefix-decorators-' + Date.now());
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

    const decoratedContent = fs.readFileSync(path.join(outDir, 'src', 'decorated.ts'), 'utf-8');
    // Decorated class name preserved
    expect(decoratedContent).toContain('class DecoratedHandler');
    expect(decoratedContent).not.toContain('class _DecoratedHandler');
    // Decorated method name preserved
    expect(decoratedContent).toContain('handle');
    expect(decoratedContent).not.toContain('_handle');
    // Non-decorated private member prefixed
    expect(decoratedContent).toContain('_hidden');
    // Non-decorated method prefixed
    expect(decoratedContent).toContain('_helperMethod');

    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
