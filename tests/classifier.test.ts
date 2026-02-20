import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createProgramFromConfig } from '../src/program.js';
import { discoverPublicApiSurface } from '../src/api-surface.js';
import { classifySymbols } from '../src/classifier.js';

const TEST_PROJECT = path.resolve(import.meta.dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(import.meta.dirname, '../test-project/src/index.ts');

describe('classifier', () => {
  function getClassification() {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);
    return classifySymbols(program, checker, publicSymbols, [TEST_ENTRY], '_');
  }

  it('marks internal class as prefix', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    expect(prefixNames).toContain('LinkMap');
  });

  it('marks private members of public class as prefix', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    expect(prefixNames).toContain('Processor.links');
    expect(prefixNames).toContain('Processor.pending');
    expect(prefixNames).toContain('Processor.cache');
    expect(prefixNames).toContain('Processor.toKey');
    expect(prefixNames).toContain('Processor.mark');
    expect(prefixNames).toContain('Processor.refresh');
  });

  it('marks internal functions as prefix', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    expect(prefixNames).toContain('makeKey');
    expect(prefixNames).toContain('splitKey');
    expect(prefixNames).toContain('summarizeShape');
  });

  it('marks internal type aliases and their members as prefix', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    expect(prefixNames).toContain('InternalShape');
    expect(prefixNames).toContain('InternalShape.count');
    expect(prefixNames).toContain('InternalShape.label');
  });

  it('marks all members of internal class as prefix', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    expect(prefixNames).toContain('LinkMap.forward');
    expect(prefixNames).toContain('LinkMap.reverse');
    expect(prefixNames).toContain('LinkMap.connect');
    expect(prefixNames).toContain('LinkMap.followers');
    expect(prefixNames).toContain('LinkMap.targets');
    expect(prefixNames).toContain('LinkMap.hasLoop');
  });

  it('does NOT mark public class as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('Processor');
  });

  it('does NOT mark public methods as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('Processor.setEntry');
    expect(noPrefixNames).toContain('Processor.getEntry');
  });

  it('does NOT mark exported interfaces as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('Coord');
    expect(noPrefixNames).toContain('CoordRange');
    expect(noPrefixNames).toContain('CoordKind');
  });

  it('does NOT mark exported interface members as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('Coord.ns');
    expect(noPrefixNames).toContain('Coord.x');
    expect(noPrefixNames).toContain('Coord.y');
  });

  it('does NOT mark exported enum members as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('CoordKind.Alpha');
    expect(noPrefixNames).toContain('CoordKind.Beta');
    expect(noPrefixNames).toContain('CoordKind.Gamma');
  });
});
