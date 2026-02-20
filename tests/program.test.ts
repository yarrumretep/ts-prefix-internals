import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createProgramFromConfig, createLanguageService } from '../src/program.js';

const TEST_PROJECT = path.resolve(import.meta.dirname, '../test-project/tsconfig.json');

describe('program', () => {
  it('creates a program from tsconfig', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    expect(program).toBeDefined();
    const checker = program.getTypeChecker();
    expect(checker).toBeDefined();
  });

  it('finds all source files in the test project', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const sourceFiles = program.getSourceFiles()
      .filter(sf => !sf.isDeclarationFile && !sf.fileName.includes('node_modules'));
    const fileNames = sourceFiles.map(sf => path.basename(sf.fileName));
    expect(fileNames).toContain('index.ts');
    expect(fileNames).toContain('engine.ts');
    expect(fileNames).toContain('graph.ts');
    expect(fileNames).toContain('types.ts');
    expect(fileNames).toContain('utils.ts');
  });

  it('creates a language service', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const ls = createLanguageService(program);
    expect(ls).toBeDefined();
  });
});
