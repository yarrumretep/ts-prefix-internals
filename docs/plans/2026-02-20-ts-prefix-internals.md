# ts-prefix-internals Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript CLI tool that prefixes all internal (non-public-API) symbols with `_` to enable aggressive property mangling by terser/esbuild.

**Architecture:** Six modules — `cli.ts` (arg parsing), `config.ts` (types), `program.ts` (TS compiler setup), `api-surface.ts` (public API discovery from entry points), `classifier.ts` (symbol classification), `renamer.ts` (Language Service rename). Orchestrated by `index.ts`. Uses TypeScript Compiler API for type-aware symbol resolution and Language Service for safe multi-file renaming.

**Tech Stack:** TypeScript (latest), `typescript` compiler API (only runtime dep), `vitest` for testing, `tsx` for running

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/config.ts`
- Create: `src/index.ts` (stub)
- Create: `src/cli.ts` (stub)

**Step 1: Initialize package.json**

```json
{
  "name": "ts-prefix-internals",
  "version": "0.1.0",
  "description": "TypeScript symbol prefixer for aggressive minification",
  "type": "module",
  "main": "dist/index.js",
  "bin": {
    "ts-prefix-internals": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "typescript": "^5.7.0"
  },
  "devDependencies": {
    "vitest": "^3.0.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "test-project", "tests"]
}
```

**Step 3: Create src/config.ts with configuration types**

```typescript
export interface PrefixConfig {
  projectPath: string;       // Path to tsconfig.json
  entryPoints: string[];     // Public API entry point files (absolute paths)
  outDir: string;            // Output directory
  prefix: string;            // Prefix string, default "_"
  dryRun: boolean;           // Don't write files, just report
  verbose: boolean;          // Print every rename decision
  skipValidation: boolean;   // Skip post-rename type-check
}

export const DEFAULT_PREFIX = '_';

export interface RenameDecision {
  symbolName: string;
  qualifiedName: string;     // e.g. "ClassName.methodName"
  kind: string;              // e.g. "class", "method", "property", "function", "variable", "enum", "interface", "type"
  fileName: string;
  line: number;
  newName: string;
  reason: string;            // Why it was classified this way
}

export interface PrefixResult {
  willPrefix: RenameDecision[];
  willNotPrefix: RenameDecision[];
  warnings: string[];
  outputFiles: Map<string, string>;  // fileName -> new content
}
```

**Step 4: Create stub src/index.ts**

```typescript
export { type PrefixConfig, type PrefixResult } from './config.js';
```

**Step 5: Create stub src/cli.ts**

```typescript
#!/usr/bin/env node
console.log('ts-prefix-internals - not yet implemented');
```

**Step 6: Install dependencies and verify build**

Run: `npm install`
Expected: Clean install

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git init
git add -A
git commit -m "feat: project scaffolding with config types"
```

---

### Task 2: Test Project Fixture

**Files:**
- Create: `test-project/tsconfig.json`
- Create: `test-project/src/types.ts`
- Create: `test-project/src/graph.ts`
- Create: `test-project/src/engine.ts`
- Create: `test-project/src/utils.ts`
- Create: `test-project/src/index.ts`

**Step 1: Create test-project/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

**Step 2: Create test-project/src/types.ts**

```typescript
export interface CellAddress {
  sheet: string;
  row: number;
  col: number;
}

export interface CellRange {
  start: CellAddress;
  end: CellAddress;
}

export enum CellType {
  Number = 'number',
  Text = 'text',
  Formula = 'formula',
}
```

**Step 3: Create test-project/src/graph.ts**

```typescript
export class DependencyGraph {
  private adjacency: Map<string, Set<string>>;
  private reverseAdjacency: Map<string, Set<string>>;

  constructor() {
    this.adjacency = new Map();
    this.reverseAdjacency = new Map();
  }

  addDependency(from: string, to: string): void {
    if (!this.adjacency.has(from)) {
      this.adjacency.set(from, new Set());
    }
    this.adjacency.get(from)!.add(to);
    if (!this.reverseAdjacency.has(to)) {
      this.reverseAdjacency.set(to, new Set());
    }
    this.reverseAdjacency.get(to)!.add(from);
  }

  getDependents(key: string): Set<string> {
    return this.reverseAdjacency.get(key) ?? new Set();
  }

  getDependencies(key: string): Set<string> {
    return this.adjacency.get(key) ?? new Set();
  }

  hasCycle(): boolean {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const dfs = (node: string): boolean => {
      visited.add(node);
      inStack.add(node);
      const deps = this.adjacency.get(node) ?? new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (dfs(dep)) return true;
        } else if (inStack.has(dep)) {
          return true;
        }
      }
      inStack.delete(node);
      return false;
    };
    for (const node of this.adjacency.keys()) {
      if (!visited.has(node)) {
        if (dfs(node)) return true;
      }
    }
    return false;
  }
}
```

**Step 4: Create test-project/src/engine.ts**

```typescript
import { CellAddress } from './types.js';
import { DependencyGraph } from './graph.js';

export class CalculationEngine {
  private graph: DependencyGraph;
  private dirtySet: Set<string>;
  private valueCache: Map<string, number>;

  constructor() {
    this.graph = new DependencyGraph();
    this.dirtySet = new Set();
    this.valueCache = new Map();
  }

  public setCellValue(address: CellAddress, value: number): void {
    const key = this.addressToKey(address);
    this.valueCache.set(key, value);
    this.markDirty(key);
  }

  public getCellValue(address: CellAddress): number | undefined {
    const key = this.addressToKey(address);
    if (this.dirtySet.has(key)) {
      this.recalculate(key);
    }
    return this.valueCache.get(key);
  }

  private addressToKey(address: CellAddress): string {
    return `${address.sheet}!${address.row}:${address.col}`;
  }

  private markDirty(key: string): void {
    this.dirtySet.add(key);
    const dependents = this.graph.getDependents(key);
    for (const dep of dependents) {
      this.markDirty(dep);
    }
  }

  private recalculate(key: string): void {
    this.dirtySet.delete(key);
  }
}
```

**Step 5: Create test-project/src/utils.ts**

```typescript
export function hashKey(sheet: string, row: number, col: number): string {
  return `${sheet}!${row}:${col}`;
}

export function parseKey(key: string): { sheet: string; row: number; col: number } {
  const [sheet, rest] = key.split('!');
  const [row, col] = rest.split(':').map(Number);
  return { sheet, row, col };
}
```

**Step 6: Create test-project/src/index.ts (barrel export)**

```typescript
export { CalculationEngine } from './engine.js';
export { CellAddress, CellRange, CellType } from './types.js';
```

**Step 7: Verify test project compiles**

Run: `cd test-project && npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add test-project/
git commit -m "feat: add test project fixture"
```

---

### Task 3: TypeScript Program Setup (`program.ts`)

**Files:**
- Create: `src/program.ts`
- Create: `tests/program.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/program.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createProgramFromConfig, createLanguageService } from '../src/program.js';

const TEST_PROJECT = path.resolve(__dirname, '../test-project/tsconfig.json');

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
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/program.test.ts`
Expected: FAIL — module not found

**Step 3: Implement src/program.ts**

```typescript
import ts from 'typescript';
import path from 'node:path';

export function createProgramFromConfig(tsconfigPath: string): ts.Program {
  const absolutePath = path.resolve(tsconfigPath);
  const configFile = ts.readConfigFile(absolutePath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`);
  }

  const basePath = path.dirname(absolutePath);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, basePath);
  if (parsed.errors.length > 0) {
    const messages = parsed.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    throw new Error(`tsconfig parse errors:\n${messages.join('\n')}`);
  }

  return ts.createProgram(parsed.fileNames, parsed.options);
}

class InMemoryLanguageServiceHost implements ts.LanguageServiceHost {
  private files: Map<string, { content: string; version: number }>;
  private options: ts.CompilerOptions;
  private fileNames: string[];

  constructor(program: ts.Program) {
    this.options = program.getCompilerOptions();
    this.files = new Map();
    this.fileNames = [];

    for (const sf of program.getSourceFiles()) {
      this.files.set(sf.fileName, { content: sf.getFullText(), version: 0 });
      this.fileNames.push(sf.fileName);
    }
  }

  getCompilationSettings = () => this.options;
  getScriptFileNames = () => this.fileNames;
  getScriptVersion = (fileName: string) => String(this.files.get(fileName)?.version ?? 0);
  getScriptSnapshot = (fileName: string) => {
    const file = this.files.get(fileName);
    return file ? ts.ScriptSnapshot.fromString(file.content) : undefined;
  };
  getCurrentDirectory = () => ts.sys.getCurrentDirectory();
  getDefaultLibFileName = (options: ts.CompilerOptions) => ts.getDefaultLibFilePath(options);
  fileExists = ts.sys.fileExists;
  readFile = ts.sys.readFile;
  readDirectory = ts.sys.readDirectory;
  directoryExists = ts.sys.directoryExists;
  getDirectories = ts.sys.getDirectories;
}

export function createLanguageService(program: ts.Program): ts.LanguageService {
  const host = new InMemoryLanguageServiceHost(program);
  return ts.createLanguageService(host, ts.createDocumentRegistry());
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/program.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/program.ts tests/program.test.ts
git commit -m "feat: TypeScript program and language service setup"
```

---

### Task 4: Public API Surface Discovery (`api-surface.ts`)

**Files:**
- Create: `src/api-surface.ts`
- Create: `tests/api-surface.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/api-surface.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createProgramFromConfig } from '../src/program.js';
import { discoverPublicApiSurface } from '../src/api-surface.js';

const TEST_PROJECT = path.resolve(__dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(__dirname, '../test-project/src/index.ts');

describe('api-surface', () => {
  it('discovers all public symbols from barrel export', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);

    // Get symbol names for easier assertion
    const names = new Set<string>();
    for (const sym of publicSymbols) {
      names.add(sym.getName());
    }

    // Directly exported symbols
    expect(names.has('CalculationEngine')).toBe(true);
    expect(names.has('CellAddress')).toBe(true);
    expect(names.has('CellRange')).toBe(true);
    expect(names.has('CellType')).toBe(true);

    // NOT exported from barrel
    expect(names.has('DependencyGraph')).toBe(false);
    expect(names.has('hashKey')).toBe(false);
    expect(names.has('parseKey')).toBe(false);
  });

  it('includes public members of exported classes', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);

    const names = new Set<string>();
    for (const sym of publicSymbols) {
      names.add(sym.getName());
    }

    // Public methods of CalculationEngine
    expect(names.has('setCellValue')).toBe(true);
    expect(names.has('getCellValue')).toBe(true);

    // Private methods/properties should NOT be in public API
    expect(names.has('addressToKey')).toBe(false);
    expect(names.has('markDirty')).toBe(false);
    expect(names.has('recalculate')).toBe(false);
  });

  it('includes members of exported interfaces', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);

    const names = new Set<string>();
    for (const sym of publicSymbols) {
      names.add(sym.getName());
    }

    // CellAddress members
    expect(names.has('sheet')).toBe(true);
    expect(names.has('row')).toBe(true);
    expect(names.has('col')).toBe(true);

    // CellRange members (start, end)
    expect(names.has('start')).toBe(true);
    expect(names.has('end')).toBe(true);
  });

  it('includes members of exported enums', () => {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);

    const names = new Set<string>();
    for (const sym of publicSymbols) {
      names.add(sym.getName());
    }

    expect(names.has('Number')).toBe(true);
    expect(names.has('Text')).toBe(true);
    expect(names.has('Formula')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api-surface.test.ts`
Expected: FAIL — module not found

**Step 3: Implement src/api-surface.ts**

This is the most complex module. It must:
1. Walk exports of entry point files
2. Resolve aliases with `checker.getAliasedSymbol()`
3. For each public symbol, walk its type signature recursively to find all referenced types
4. Include public/protected members of exported classes
5. Include members of exported interfaces and enums

```typescript
import ts from 'typescript';

export function discoverPublicApiSurface(
  program: ts.Program,
  checker: ts.TypeChecker,
  entryPoints: string[]
): Set<ts.Symbol> {
  const publicSymbols = new Set<ts.Symbol>();
  const visited = new Set<ts.Symbol>();

  function addSymbol(symbol: ts.Symbol): void {
    if (!symbol || visited.has(symbol)) return;
    visited.add(symbol);

    // Resolve aliases
    let resolved = symbol;
    if (resolved.flags & ts.SymbolFlags.Alias) {
      try {
        resolved = checker.getAliasedSymbol(resolved);
      } catch {
        // Some aliases can't be resolved
      }
    }

    if (visited.has(resolved) && resolved !== symbol) {
      publicSymbols.add(resolved);
      return;
    }
    visited.add(resolved);
    publicSymbols.add(resolved);

    // Walk members of classes, interfaces, enums
    walkMembers(resolved);

    // Walk the type of this symbol to find referenced types
    walkSymbolType(resolved);
  }

  function walkMembers(symbol: ts.Symbol): void {
    // Handle class members
    if (symbol.flags & ts.SymbolFlags.Class) {
      const decls = symbol.getDeclarations() ?? [];
      for (const decl of decls) {
        if (ts.isClassDeclaration(decl)) {
          for (const member of decl.members) {
            // Only include public and protected members
            const modifiers = ts.getCombinedModifierFlags(member);
            if (modifiers & ts.ModifierFlags.Private) continue;

            const memberSymbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
            if (memberSymbol) {
              addSymbol(memberSymbol);
            }
          }

          // Walk heritage clauses (extends/implements) for type references
          if (decl.heritageClauses) {
            for (const clause of decl.heritageClauses) {
              for (const typeNode of clause.types) {
                walkTypeNode(typeNode);
              }
            }
          }
        }
      }
    }

    // Handle interface members
    if (symbol.flags & ts.SymbolFlags.Interface) {
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      const properties = type.getProperties();
      for (const prop of properties) {
        addSymbol(prop);
      }

      // Walk heritage (extended interfaces)
      const decls = symbol.getDeclarations() ?? [];
      for (const decl of decls) {
        if (ts.isInterfaceDeclaration(decl) && decl.heritageClauses) {
          for (const clause of decl.heritageClauses) {
            for (const typeNode of clause.types) {
              walkTypeNode(typeNode);
            }
          }
        }
      }
    }

    // Handle enum members
    if (symbol.flags & ts.SymbolFlags.Enum) {
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      // Enum members are available via exports
      if (symbol.exports) {
        symbol.exports.forEach((memberSymbol) => {
          publicSymbols.add(memberSymbol);
          visited.add(memberSymbol);
        });
      }
    }
  }

  function walkSymbolType(symbol: ts.Symbol): void {
    // Walk declarations to find type references
    const decls = symbol.getDeclarations() ?? [];
    for (const decl of decls) {
      // Walk all type nodes in the declaration
      walkDeclarationTypes(decl);
    }
  }

  function walkDeclarationTypes(node: ts.Node): void {
    // Method/function signatures: walk parameter types and return types
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
      const sig = node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.MethodSignature;
      if (sig.type) walkTypeNode(sig.type);
      for (const param of sig.parameters) {
        if (param.type) walkTypeNode(param.type);
      }
      if (sig.typeParameters) {
        for (const tp of sig.typeParameters) {
          if (tp.constraint) walkTypeNode(tp.constraint);
          if (tp.default) walkTypeNode(tp.default);
        }
      }
    }

    // Property declarations/signatures
    if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
      if (node.type) walkTypeNode(node.type);
    }

    // Variable declarations
    if (ts.isVariableDeclaration(node)) {
      if (node.type) walkTypeNode(node.type);
    }

    // Type alias
    if (ts.isTypeAliasDeclaration(node)) {
      walkTypeNode(node.type);
      if (node.typeParameters) {
        for (const tp of node.typeParameters) {
          if (tp.constraint) walkTypeNode(tp.constraint);
          if (tp.default) walkTypeNode(tp.default);
        }
      }
    }

    // Class/interface: already handled in walkMembers
  }

  function walkTypeNode(typeNode: ts.TypeNode): void {
    if (!typeNode) return;

    // Type reference (e.g., CellAddress, Promise<T>)
    if (ts.isTypeReferenceNode(typeNode)) {
      const symbol = checker.getSymbolAtLocation(typeNode.typeName);
      if (symbol) addSymbol(symbol);

      // Walk type arguments
      if (typeNode.typeArguments) {
        for (const arg of typeNode.typeArguments) {
          walkTypeNode(arg);
        }
      }
    }

    // Array type
    if (ts.isArrayTypeNode(typeNode)) {
      walkTypeNode(typeNode.elementType);
    }

    // Tuple type
    if (ts.isTupleTypeNode(typeNode)) {
      for (const el of typeNode.elements) {
        walkTypeNode(el);
      }
    }

    // Union/intersection type
    if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
      for (const t of typeNode.types) {
        walkTypeNode(t);
      }
    }

    // Type literal (inline object type)
    if (ts.isTypeLiteralNode(typeNode)) {
      for (const member of typeNode.members) {
        if (ts.isPropertySignature(member) && member.type) {
          walkTypeNode(member.type);
        }
        if (ts.isMethodSignature(member)) {
          if (member.type) walkTypeNode(member.type);
          for (const param of member.parameters) {
            if (param.type) walkTypeNode(param.type);
          }
        }
      }
    }

    // Mapped type
    if (ts.isMappedTypeNode(typeNode)) {
      if (typeNode.type) walkTypeNode(typeNode.type);
      if (typeNode.typeParameter.constraint) walkTypeNode(typeNode.typeParameter.constraint);
    }

    // Conditional type
    if (ts.isConditionalTypeNode(typeNode)) {
      walkTypeNode(typeNode.checkType);
      walkTypeNode(typeNode.extendsType);
      walkTypeNode(typeNode.trueType);
      walkTypeNode(typeNode.falseType);
    }

    // Indexed access type
    if (ts.isIndexedAccessTypeNode(typeNode)) {
      walkTypeNode(typeNode.objectType);
      walkTypeNode(typeNode.indexType);
    }

    // Parenthesized type
    if (ts.isParenthesizedTypeNode(typeNode)) {
      walkTypeNode(typeNode.type);
    }

    // Function type
    if (ts.isFunctionTypeNode(typeNode)) {
      if (typeNode.type) walkTypeNode(typeNode.type);
      for (const param of typeNode.parameters) {
        if (param.type) walkTypeNode(param.type);
      }
    }
  }

  // Start: walk exports of each entry point
  for (const entryPath of entryPoints) {
    const sourceFile = program.getSourceFile(entryPath);
    if (!sourceFile) {
      throw new Error(`Entry point not found in program: ${entryPath}`);
    }

    const fileSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!fileSymbol) continue;

    const exports = checker.getExportsOfModule(fileSymbol);
    for (const exportedSymbol of exports) {
      addSymbol(exportedSymbol);
    }
  }

  return publicSymbols;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api-surface.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/api-surface.ts tests/api-surface.test.ts
git commit -m "feat: public API surface discovery"
```

---

### Task 5: Symbol Classification (`classifier.ts`)

**Files:**
- Create: `src/classifier.ts`
- Create: `tests/classifier.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/classifier.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createProgramFromConfig } from '../src/program.js';
import { discoverPublicApiSurface } from '../src/api-surface.js';
import { classifySymbols } from '../src/classifier.js';

const TEST_PROJECT = path.resolve(__dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(__dirname, '../test-project/src/index.ts');

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
    expect(prefixNames).toContain('DependencyGraph');
  });

  it('marks private members of public class as prefix', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    expect(prefixNames).toContain('CalculationEngine.graph');
    expect(prefixNames).toContain('CalculationEngine.dirtySet');
    expect(prefixNames).toContain('CalculationEngine.valueCache');
    expect(prefixNames).toContain('CalculationEngine.addressToKey');
    expect(prefixNames).toContain('CalculationEngine.markDirty');
    expect(prefixNames).toContain('CalculationEngine.recalculate');
  });

  it('marks internal functions as prefix', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    expect(prefixNames).toContain('hashKey');
    expect(prefixNames).toContain('parseKey');
  });

  it('marks all members of internal class as prefix', () => {
    const result = getClassification();
    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    expect(prefixNames).toContain('DependencyGraph.adjacency');
    expect(prefixNames).toContain('DependencyGraph.reverseAdjacency');
    expect(prefixNames).toContain('DependencyGraph.addDependency');
    expect(prefixNames).toContain('DependencyGraph.getDependents');
    expect(prefixNames).toContain('DependencyGraph.getDependencies');
    expect(prefixNames).toContain('DependencyGraph.hasCycle');
  });

  it('does NOT mark public class as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('CalculationEngine');
  });

  it('does NOT mark public methods as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('CalculationEngine.setCellValue');
    expect(noPrefixNames).toContain('CalculationEngine.getCellValue');
  });

  it('does NOT mark exported interfaces as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('CellAddress');
    expect(noPrefixNames).toContain('CellRange');
    expect(noPrefixNames).toContain('CellType');
  });

  it('does NOT mark exported interface members as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    // CellAddress members
    expect(noPrefixNames).toContain('CellAddress.sheet');
    expect(noPrefixNames).toContain('CellAddress.row');
    expect(noPrefixNames).toContain('CellAddress.col');
  });

  it('does NOT mark exported enum members as prefix', () => {
    const result = getClassification();
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);
    expect(noPrefixNames).toContain('CellType.Number');
    expect(noPrefixNames).toContain('CellType.Text');
    expect(noPrefixNames).toContain('CellType.Formula');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/classifier.test.ts`
Expected: FAIL — module not found

**Step 3: Implement src/classifier.ts**

```typescript
import ts from 'typescript';
import path from 'node:path';
import { RenameDecision } from './config.js';

export interface ClassificationResult {
  willPrefix: RenameDecision[];
  willNotPrefix: RenameDecision[];
  warnings: string[];
  symbolsToRename: Map<ts.Symbol, string>; // symbol -> new name
}

export function classifySymbols(
  program: ts.Program,
  checker: ts.TypeChecker,
  publicApiSymbols: Set<ts.Symbol>,
  entryPoints: string[],
  prefix: string
): ClassificationResult {
  const willPrefix: RenameDecision[] = [];
  const willNotPrefix: RenameDecision[] = [];
  const warnings: string[] = [];
  const symbolsToRename = new Map<ts.Symbol, string>();

  const entryPointSet = new Set(entryPoints.map(e => path.resolve(e)));

  // Build a set of public symbol IDs for fast lookup
  // We need to match by identity, so use the Set directly

  function isPublicSymbol(sym: ts.Symbol): boolean {
    if (publicApiSymbols.has(sym)) return true;
    // Also check aliased
    if (sym.flags & ts.SymbolFlags.Alias) {
      try {
        const resolved = checker.getAliasedSymbol(sym);
        if (publicApiSymbols.has(resolved)) return true;
      } catch {}
    }
    return false;
  }

  function isFromExternalOrDeclaration(sym: ts.Symbol): boolean {
    const decls = sym.getDeclarations();
    if (!decls || decls.length === 0) return true;
    return decls.every(d => {
      const sf = d.getSourceFile();
      return sf.isDeclarationFile || sf.fileName.includes('node_modules');
    });
  }

  function getSymbolKind(node: ts.Node): string {
    if (ts.isClassDeclaration(node)) return 'class';
    if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return 'method';
    if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return 'property';
    if (ts.isInterfaceDeclaration(node)) return 'interface';
    if (ts.isTypeAliasDeclaration(node)) return 'type';
    if (ts.isEnumDeclaration(node)) return 'enum';
    if (ts.isEnumMember(node)) return 'enum-member';
    if (ts.isFunctionDeclaration(node)) return 'function';
    if (ts.isVariableDeclaration(node)) return 'variable';
    if (ts.isParameter(node)) return 'parameter';
    if (ts.isGetAccessor(node)) return 'getter';
    if (ts.isSetAccessor(node)) return 'setter';
    return 'unknown';
  }

  function getLocation(decl: ts.Declaration): { fileName: string; line: number } {
    const sf = decl.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(decl.getStart());
    return {
      fileName: path.relative(process.cwd(), sf.fileName),
      line: line + 1,
    };
  }

  function getParentClassName(node: ts.Node): string | undefined {
    const parent = node.parent;
    if (parent && ts.isClassDeclaration(parent) && parent.name) {
      return parent.name.text;
    }
    return undefined;
  }

  function getParentSymbol(node: ts.Node): ts.Symbol | undefined {
    const parent = node.parent;
    if (parent && (ts.isClassDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isEnumDeclaration(parent))) {
      if (parent.name) {
        return checker.getSymbolAtLocation(parent.name) ?? undefined;
      }
    }
    return undefined;
  }

  function hasDecorators(node: ts.Node): boolean {
    return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []).length > 0 : false;
  }

  function processSymbol(symbol: ts.Symbol, node: ts.Declaration, parentName?: string): void {
    const name = symbol.getName();
    if (!name || name === 'constructor' || name === '__constructor') return;

    // Skip parameters
    if (ts.isParameter(node) && !ts.hasOnlyExpressionInitializer(node)) return;
    // Skip constructor parameter properties — will be handled as class members
    if (ts.isParameter(node)) {
      const modifiers = ts.getCombinedModifierFlags(node);
      if (!(modifiers & (ts.ModifierFlags.Public | ts.ModifierFlags.Protected | ts.ModifierFlags.Private | ts.ModifierFlags.Readonly))) {
        return; // regular parameter, skip
      }
    }

    const kind = getSymbolKind(node);
    if (kind === 'parameter') return;
    if (kind === 'unknown') return;

    // Skip symbols from external/declaration files
    if (isFromExternalOrDeclaration(symbol)) return;

    // Skip if name already starts with prefix
    if (name.startsWith('_')) return;

    // Skip decorated symbols
    if (hasDecorators(node)) return;

    const loc = getLocation(node);
    const qualifiedName = parentName ? `${parentName}.${name}` : name;

    // Is this symbol part of the public API?
    if (isPublicSymbol(symbol)) {
      willNotPrefix.push({
        symbolName: name,
        qualifiedName,
        kind,
        fileName: loc.fileName,
        line: loc.line,
        newName: name,
        reason: 'public API symbol',
      });
      return;
    }

    // Is this a member of a class/interface/enum?
    const parentSymbol = getParentSymbol(node);
    if (parentSymbol) {
      const parentIsPublic = isPublicSymbol(parentSymbol);

      if (parentIsPublic) {
        // Member of a public class/interface/enum
        const modifiers = ts.getCombinedModifierFlags(node);
        const isPrivate = !!(modifiers & ts.ModifierFlags.Private);

        if (isPrivate) {
          // Private member of public class → prefix
          const newName = prefix + name;
          willPrefix.push({
            symbolName: name,
            qualifiedName,
            kind,
            fileName: loc.fileName,
            line: loc.line,
            newName,
            reason: 'private member of public class',
          });
          symbolsToRename.set(symbol, newName);
        } else {
          // Public/protected member → don't prefix
          willNotPrefix.push({
            symbolName: name,
            qualifiedName,
            kind,
            fileName: loc.fileName,
            line: loc.line,
            newName: name,
            reason: 'public/protected member of public class/interface/enum',
          });
        }
      } else {
        // Member of non-public class/interface/enum → prefix
        const newName = prefix + name;
        willPrefix.push({
          symbolName: name,
          qualifiedName,
          kind,
          fileName: loc.fileName,
          line: loc.line,
          newName,
          reason: 'member of internal class/interface/enum',
        });
        symbolsToRename.set(symbol, newName);
      }
      return;
    }

    // Top-level internal symbol → prefix
    const newName = prefix + name;
    willPrefix.push({
      symbolName: name,
      qualifiedName,
      kind,
      fileName: loc.fileName,
      line: loc.line,
      newName,
      reason: 'internal symbol not exported from entry point',
    });
    symbolsToRename.set(symbol, newName);
  }

  // Walk all source files in the project
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (sourceFile.fileName.includes('node_modules')) continue;

    function visit(node: ts.Node): void {
      // Class declaration
      if (ts.isClassDeclaration(node) && node.name) {
        const sym = checker.getSymbolAtLocation(node.name);
        if (sym) {
          processSymbol(sym, node);

          // Process members
          const className = node.name.text;
          for (const member of node.members) {
            if (member.name && !ts.isComputedPropertyName(member.name)) {
              const memberSym = checker.getSymbolAtLocation(member.name);
              if (memberSym) processSymbol(memberSym, member, className);
            }
            // Constructor parameter properties
            if (ts.isConstructorDeclaration(member)) {
              for (const param of member.parameters) {
                const modifiers = ts.getCombinedModifierFlags(param);
                if (modifiers & (ts.ModifierFlags.Public | ts.ModifierFlags.Protected | ts.ModifierFlags.Private | ts.ModifierFlags.Readonly)) {
                  if (param.name && ts.isIdentifier(param.name)) {
                    const paramSym = checker.getSymbolAtLocation(param.name);
                    if (paramSym) processSymbol(paramSym, param, className);
                  }
                }
              }
            }
          }
        }
        return; // Don't recurse into class body again
      }

      // Interface declaration
      if (ts.isInterfaceDeclaration(node) && node.name) {
        const sym = checker.getSymbolAtLocation(node.name);
        if (sym) {
          processSymbol(sym, node);
          const ifaceName = node.name.text;
          for (const member of node.members) {
            if (member.name && !ts.isComputedPropertyName(member.name)) {
              const memberSym = checker.getSymbolAtLocation(member.name);
              if (memberSym) processSymbol(memberSym, member, ifaceName);
            }
          }
        }
        return;
      }

      // Enum declaration
      if (ts.isEnumDeclaration(node) && node.name) {
        const sym = checker.getSymbolAtLocation(node.name);
        if (sym) {
          processSymbol(sym, node);
          const enumName = node.name.text;
          for (const member of node.members) {
            if (member.name && !ts.isComputedPropertyName(member.name)) {
              const memberSym = checker.getSymbolAtLocation(member.name);
              if (memberSym) processSymbol(memberSym, member, enumName);
            }
          }
        }
        return;
      }

      // Type alias declaration
      if (ts.isTypeAliasDeclaration(node)) {
        const sym = checker.getSymbolAtLocation(node.name);
        if (sym) processSymbol(sym, node);
        return;
      }

      // Function declaration
      if (ts.isFunctionDeclaration(node) && node.name) {
        const sym = checker.getSymbolAtLocation(node.name);
        if (sym) processSymbol(sym, node);
        return;
      }

      // Variable statement → variable declarations
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const sym = checker.getSymbolAtLocation(decl.name);
            if (sym) processSymbol(sym, decl);
          }
        }
        return;
      }

      // Check for dynamic property access and warn
      if (ts.isElementAccessExpression(node)) {
        if (!ts.isStringLiteral(node.argumentExpression) && !ts.isNumericLiteral(node.argumentExpression)) {
          const sf = node.getSourceFile();
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          const relPath = path.relative(process.cwd(), sf.fileName);
          warnings.push(`${relPath}:${line + 1} — Dynamic property access detected — verify manually`);
        }
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  return { willPrefix, willNotPrefix, warnings, symbolsToRename };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/classifier.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/classifier.ts tests/classifier.test.ts
git commit -m "feat: symbol classification (internal vs public)"
```

---

### Task 6: Renamer (`renamer.ts`)

**Files:**
- Create: `src/renamer.ts`
- Create: `tests/renamer.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/renamer.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import ts from 'typescript';
import { createProgramFromConfig, createLanguageService } from '../src/program.js';
import { discoverPublicApiSurface } from '../src/api-surface.js';
import { classifySymbols } from '../src/classifier.js';
import { computeRenames } from '../src/renamer.js';

const TEST_PROJECT = path.resolve(__dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(__dirname, '../test-project/src/index.ts');

describe('renamer', () => {
  function getRenames() {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);
    const classification = classifySymbols(program, checker, publicSymbols, [TEST_ENTRY], '_');
    const ls = createLanguageService(program);
    return computeRenames(ls, program, classification.symbolsToRename);
  }

  it('produces output files', () => {
    const result = getRenames();
    expect(result.outputFiles.size).toBeGreaterThan(0);
  });

  it('prefixes DependencyGraph class name', () => {
    const result = getRenames();
    // Find graph.ts in output
    const graphFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('graph.ts'));
    expect(graphFile).toBeDefined();
    const [, content] = graphFile!;
    expect(content).toContain('class _DependencyGraph');
    expect(content).not.toMatch(/class DependencyGraph\b/);
  });

  it('prefixes private members of CalculationEngine', () => {
    const result = getRenames();
    const engineFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('engine.ts'));
    expect(engineFile).toBeDefined();
    const [, content] = engineFile!;
    // Private fields should be prefixed
    expect(content).toContain('_graph');
    expect(content).toContain('_dirtySet');
    expect(content).toContain('_valueCache');
    expect(content).toContain('_addressToKey');
    expect(content).toContain('_markDirty');
    expect(content).toContain('_recalculate');
  });

  it('does NOT prefix public methods of CalculationEngine', () => {
    const result = getRenames();
    const engineFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('engine.ts'));
    expect(engineFile).toBeDefined();
    const [, content] = engineFile!;
    expect(content).toContain('setCellValue');
    expect(content).toContain('getCellValue');
    expect(content).not.toContain('_setCellValue');
    expect(content).not.toContain('_getCellValue');
  });

  it('does NOT modify exported interface members', () => {
    const result = getRenames();
    const typesFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('types.ts'));
    expect(typesFile).toBeDefined();
    const [, content] = typesFile!;
    expect(content).toContain('sheet:');
    expect(content).toContain('row:');
    expect(content).toContain('col:');
    expect(content).not.toContain('_sheet');
    expect(content).not.toContain('_row');
    expect(content).not.toContain('_col');
  });

  it('updates import of DependencyGraph in engine.ts', () => {
    const result = getRenames();
    const engineFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('engine.ts'));
    expect(engineFile).toBeDefined();
    const [, content] = engineFile!;
    expect(content).toContain('_DependencyGraph');
  });

  it('prefixes internal utility functions', () => {
    const result = getRenames();
    const utilsFile = [...result.outputFiles.entries()].find(([k]) => k.endsWith('utils.ts'));
    expect(utilsFile).toBeDefined();
    const [, content] = utilsFile!;
    expect(content).toContain('function _hashKey');
    expect(content).toContain('function _parseKey');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renamer.test.ts`
Expected: FAIL — module not found

**Step 3: Implement src/renamer.ts**

```typescript
import ts from 'typescript';

interface PendingEdit {
  fileName: string;
  start: number;
  length: number;
  newText: string;
}

export interface RenameResult {
  outputFiles: Map<string, string>;   // fileName -> rewritten content
  errors: string[];
}

export function computeRenames(
  languageService: ts.LanguageService,
  program: ts.Program,
  symbolsToRename: Map<ts.Symbol, string>
): RenameResult {
  const allEdits: PendingEdit[] = [];
  const errors: string[] = [];

  // Collect original source texts
  const originalSources = new Map<string, string>();
  for (const sf of program.getSourceFiles()) {
    originalSources.set(sf.fileName, sf.getFullText());
  }

  // Gather all rename edits
  for (const [symbol, newName] of symbolsToRename) {
    const decls = symbol.getDeclarations();
    if (!decls || decls.length === 0) continue;

    // Find a declaration with a name node to use for rename
    let targetFile: string | undefined;
    let targetPos: number | undefined;

    for (const decl of decls) {
      const sf = decl.getSourceFile();
      if (sf.isDeclarationFile || sf.fileName.includes('node_modules')) continue;

      // Get the name position
      let nameNode: ts.Node | undefined;

      if ('name' in decl && (decl as any).name) {
        nameNode = (decl as any).name;
      }

      if (nameNode) {
        targetFile = sf.fileName;
        targetPos = nameNode.getStart();
        break;
      }
    }

    if (targetFile === undefined || targetPos === undefined) continue;

    const locations = languageService.findRenameLocations(
      targetFile, targetPos, false, false, false
    );

    if (!locations) {
      errors.push(`Could not find rename locations for ${symbol.getName()} at ${targetFile}:${targetPos}`);
      continue;
    }

    for (const loc of locations) {
      allEdits.push({
        fileName: loc.fileName,
        start: loc.textSpan.start,
        length: loc.textSpan.length,
        newText: newName,
      });
    }
  }

  // Group edits by file
  const editsByFile = new Map<string, PendingEdit[]>();
  for (const edit of allEdits) {
    const existing = editsByFile.get(edit.fileName) ?? [];
    existing.push(edit);
    editsByFile.set(edit.fileName, existing);
  }

  // Apply edits bottom-to-top per file
  const outputFiles = new Map<string, string>();
  for (const [fileName, edits] of editsByFile) {
    // Deduplicate edits at the same position (can happen with overloads)
    const deduped = new Map<string, PendingEdit>();
    for (const edit of edits) {
      const key = `${edit.start}:${edit.length}`;
      deduped.set(key, edit);
    }
    const uniqueEdits = [...deduped.values()];

    // Sort reverse by position
    uniqueEdits.sort((a, b) => b.start - a.start);

    let text = originalSources.get(fileName);
    if (text === undefined) continue;

    for (const edit of uniqueEdits) {
      text = text.slice(0, edit.start) + edit.newText + text.slice(edit.start + edit.length);
    }
    outputFiles.set(fileName, text);
  }

  // Also include files that had no edits (copy as-is) — only project source files
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || sf.fileName.includes('node_modules')) continue;
    if (!outputFiles.has(sf.fileName)) {
      outputFiles.set(sf.fileName, sf.getFullText());
    }
  }

  return { outputFiles, errors };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renamer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renamer.ts tests/renamer.test.ts
git commit -m "feat: rename engine using TS Language Service"
```

---

### Task 7: Main Orchestration (`index.ts`)

**Files:**
- Modify: `src/index.ts`
- Create: `tests/index.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/index.test.ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { prefixInternals } from '../src/index.js';

const TEST_PROJECT = path.resolve(__dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(__dirname, '../test-project/src/index.ts');

describe('prefixInternals', () => {
  it('dry run reports correct decisions', async () => {
    const result = await prefixInternals({
      projectPath: TEST_PROJECT,
      entryPoints: [TEST_ENTRY],
      outDir: path.join(os.tmpdir(), 'ts-prefix-test-' + Date.now()),
      prefix: '_',
      dryRun: true,
      verbose: false,
      skipValidation: true,
    });

    const prefixNames = result.willPrefix.map(d => d.qualifiedName);
    const noPrefixNames = result.willNotPrefix.map(d => d.qualifiedName);

    // Verify internal symbols are prefixed
    expect(prefixNames).toContain('DependencyGraph');
    expect(prefixNames).toContain('hashKey');
    expect(prefixNames).toContain('parseKey');
    expect(prefixNames).toContain('CalculationEngine.graph');

    // Verify public symbols are not prefixed
    expect(noPrefixNames).toContain('CalculationEngine');
    expect(noPrefixNames).toContain('CalculationEngine.setCellValue');
    expect(noPrefixNames).toContain('CellAddress');
  });

  it('writes output files that compile', async () => {
    const outDir = path.join(os.tmpdir(), 'ts-prefix-test-' + Date.now());
    const result = await prefixInternals({
      projectPath: TEST_PROJECT,
      entryPoints: [TEST_ENTRY],
      outDir,
      prefix: '_',
      dryRun: false,
      verbose: false,
      skipValidation: false,
    });

    // Check that output files were written
    expect(fs.existsSync(path.join(outDir, 'src', 'engine.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'src', 'graph.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'tsconfig.json'))).toBe(true);

    // No validation errors
    expect(result.validationErrors).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/index.test.ts`
Expected: FAIL — function not found

**Step 3: Implement src/index.ts**

```typescript
import ts from 'typescript';
import path from 'node:path';
import fs from 'node:fs';
import { PrefixConfig, PrefixResult, RenameDecision } from './config.js';
import { createProgramFromConfig, createLanguageService } from './program.js';
import { discoverPublicApiSurface } from './api-surface.js';
import { classifySymbols } from './classifier.js';
import { computeRenames } from './renamer.js';

export { type PrefixConfig, type PrefixResult } from './config.js';

export interface FullResult extends PrefixResult {
  validationErrors?: string[];
}

export async function prefixInternals(config: PrefixConfig): Promise<FullResult> {
  const { projectPath, entryPoints, outDir, prefix, dryRun, skipValidation } = config;

  // 1. Create TypeScript program
  const program = createProgramFromConfig(projectPath);
  const checker = program.getTypeChecker();

  // 2. Discover public API surface
  const publicApiSymbols = discoverPublicApiSurface(program, checker, entryPoints);

  // 3. Classify symbols
  const classification = classifySymbols(program, checker, publicApiSymbols, entryPoints, prefix);

  if (dryRun) {
    return {
      willPrefix: classification.willPrefix,
      willNotPrefix: classification.willNotPrefix,
      warnings: classification.warnings,
      outputFiles: new Map(),
    };
  }

  // 4. Compute renames
  const ls = createLanguageService(program);
  const renameResult = computeRenames(ls, program, classification.symbolsToRename);

  // 5. Write output files
  const projectDir = path.dirname(path.resolve(projectPath));
  const absoluteOutDir = path.resolve(outDir);

  fs.mkdirSync(absoluteOutDir, { recursive: true });

  for (const [fileName, content] of renameResult.outputFiles) {
    const relativePath = path.relative(projectDir, fileName);
    const outPath = path.join(absoluteOutDir, relativePath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, content);
  }

  // Copy tsconfig.json to output, adjusting rootDir if needed
  const tsconfigContent = fs.readFileSync(path.resolve(projectPath), 'utf-8');
  const tsconfigOutPath = path.join(absoluteOutDir, 'tsconfig.json');
  fs.writeFileSync(tsconfigOutPath, tsconfigContent);

  // 6. Validate output compiles
  let validationErrors: string[] | undefined;
  if (!skipValidation) {
    validationErrors = validateOutput(tsconfigOutPath);
    if (validationErrors.length === 0) {
      validationErrors = undefined;
    }
  }

  return {
    willPrefix: classification.willPrefix,
    willNotPrefix: classification.willNotPrefix,
    warnings: classification.warnings,
    outputFiles: renameResult.outputFiles,
    validationErrors,
  };
}

function validateOutput(tsconfigPath: string): string[] {
  const program = createProgramFromConfig(tsconfigPath);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  return diagnostics.map(d => {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n');
    if (d.file && d.start !== undefined) {
      const { line } = d.file.getLineAndCharacterOfPosition(d.start);
      return `${path.relative(process.cwd(), d.file.fileName)}:${line + 1}: ${msg}`;
    }
    return msg;
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: main orchestration with output writing and validation"
```

---

### Task 8: CLI (`cli.ts`)

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/cli.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli.js';

describe('parseArgs', () => {
  it('parses required args', () => {
    const config = parseArgs([
      '--project', 'tsconfig.json',
      '--entry', 'src/index.ts',
      '--outDir', 'dist',
    ]);
    expect(config.projectPath).toBe('tsconfig.json');
    expect(config.entryPoints).toEqual(['src/index.ts']);
    expect(config.outDir).toBe('dist');
    expect(config.prefix).toBe('_');
    expect(config.dryRun).toBe(false);
    expect(config.verbose).toBe(false);
    expect(config.skipValidation).toBe(false);
  });

  it('parses short flags', () => {
    const config = parseArgs([
      '-p', 'tsconfig.json',
      '-e', 'src/index.ts',
      '-o', 'dist',
    ]);
    expect(config.projectPath).toBe('tsconfig.json');
    expect(config.entryPoints).toEqual(['src/index.ts']);
    expect(config.outDir).toBe('dist');
  });

  it('parses multiple entry points', () => {
    const config = parseArgs([
      '-p', 'tsconfig.json',
      '-e', 'src/index.ts',
      '-e', 'src/other.ts',
      '-o', 'dist',
    ]);
    expect(config.entryPoints).toEqual(['src/index.ts', 'src/other.ts']);
  });

  it('parses optional flags', () => {
    const config = parseArgs([
      '-p', 'tsconfig.json',
      '-e', 'src/index.ts',
      '-o', 'dist',
      '--prefix', '__',
      '--dry-run',
      '--verbose',
      '--skip-validation',
    ]);
    expect(config.prefix).toBe('__');
    expect(config.dryRun).toBe(true);
    expect(config.verbose).toBe(true);
    expect(config.skipValidation).toBe(true);
  });

  it('throws on missing required args', () => {
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(['-p', 'tsconfig.json'])).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.test.ts`
Expected: FAIL

**Step 3: Implement src/cli.ts**

```typescript
#!/usr/bin/env node
import path from 'node:path';
import { PrefixConfig, DEFAULT_PREFIX } from './config.js';
import { prefixInternals } from './index.js';

export function parseArgs(args: string[]): PrefixConfig {
  let projectPath = '';
  const entryPoints: string[] = [];
  let outDir = '';
  let prefix = DEFAULT_PREFIX;
  let dryRun = false;
  let verbose = false;
  let skipValidation = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--project':
      case '-p':
        projectPath = args[++i];
        break;
      case '--entry':
      case '-e':
        entryPoints.push(args[++i]);
        break;
      case '--outDir':
      case '-o':
        outDir = args[++i];
        break;
      case '--prefix':
        prefix = args[++i];
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--verbose':
        verbose = true;
        break;
      case '--skip-validation':
        skipValidation = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
    }
  }

  if (!projectPath) throw new Error('--project / -p is required');
  if (entryPoints.length === 0) throw new Error('--entry / -e is required (at least one)');
  if (!outDir) throw new Error('--outDir / -o is required');

  return {
    projectPath: path.resolve(projectPath),
    entryPoints: entryPoints.map(e => path.resolve(e)),
    outDir: path.resolve(outDir),
    prefix,
    dryRun,
    verbose,
    skipValidation,
  };
}

function formatDryRun(willPrefix: any[], willNotPrefix: any[], warnings: string[]): string {
  const lines: string[] = [];

  lines.push('WILL PREFIX (internal):');
  for (const d of willPrefix) {
    const pad = 40 - d.qualifiedName.length;
    lines.push(`  ${d.qualifiedName}${' '.repeat(Math.max(1, pad))}${d.kind.padEnd(12)} ${d.fileName}:${d.line}${''.padEnd(4)}→ ${d.newName}`);
  }

  lines.push('');
  lines.push('WILL NOT PREFIX (public API):');
  for (const d of willNotPrefix) {
    const pad = 40 - d.qualifiedName.length;
    lines.push(`  ${d.qualifiedName}${' '.repeat(Math.max(1, pad))}${d.kind.padEnd(12)} ${d.fileName}:${d.line}${''.padEnd(4)}(${d.reason})`);
  }

  if (warnings.length > 0) {
    lines.push('');
    lines.push('WARNINGS:');
    for (const w of warnings) {
      lines.push(`  ${w}`);
    }
  }

  return lines.join('\n');
}

async function main() {
  try {
    const config = parseArgs(process.argv.slice(2));

    if (config.verbose) {
      console.log('Configuration:', JSON.stringify(config, null, 2));
    }

    const result = await prefixInternals(config);

    if (config.dryRun) {
      console.log(formatDryRun(result.willPrefix, result.willNotPrefix, result.warnings));
    } else {
      console.log(`Prefixed ${result.willPrefix.length} symbols.`);
      console.log(`Skipped ${result.willNotPrefix.length} public API symbols.`);
      if (result.warnings.length > 0) {
        console.log(`\nWarnings (${result.warnings.length}):`);
        for (const w of result.warnings) {
          console.log(`  ${w}`);
        }
      }
      if ((result as any).validationErrors) {
        console.error(`\nValidation errors (${(result as any).validationErrors.length}):`);
        for (const e of (result as any).validationErrors) {
          console.error(`  ${e}`);
        }
        process.exit(1);
      } else if (!config.skipValidation) {
        console.log('\nOutput compiles successfully.');
      }
      console.log(`\nOutput written to: ${config.outDir}`);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

// Only run main when executed directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('/cli.js') ||
  process.argv[1].endsWith('/cli.ts')
);
if (isDirectRun) {
  main();
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: CLI argument parsing and output formatting"
```

---

### Task 9: End-to-End Test

**Files:**
- Create: `tests/e2e.test.ts`

**Step 1: Write the end-to-end test**

```typescript
// tests/e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { prefixInternals } from '../src/index.js';

const TEST_PROJECT = path.resolve(__dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(__dirname, '../test-project/src/index.ts');

describe('end-to-end', () => {
  let outDir: string;
  let result: Awaited<ReturnType<typeof prefixInternals>>;

  beforeAll(async () => {
    outDir = path.join(os.tmpdir(), 'ts-prefix-e2e-' + Date.now());
    result = await prefixInternals({
      projectPath: TEST_PROJECT,
      entryPoints: [TEST_ENTRY],
      outDir,
      prefix: '_',
      dryRun: false,
      verbose: false,
      skipValidation: false,
    });
  });

  afterAll(() => {
    // Cleanup
    if (outDir && fs.existsSync(outDir)) {
      fs.rmSync(outDir, { recursive: true });
    }
  });

  it('produces no validation errors', () => {
    expect(result.validationErrors).toBeUndefined();
  });

  it('prefixes all expected internal symbols', () => {
    const prefixed = new Set(result.willPrefix.map(d => d.qualifiedName));

    // Internal class
    expect(prefixed.has('DependencyGraph')).toBe(true);
    expect(prefixed.has('DependencyGraph.adjacency')).toBe(true);
    expect(prefixed.has('DependencyGraph.reverseAdjacency')).toBe(true);
    expect(prefixed.has('DependencyGraph.addDependency')).toBe(true);
    expect(prefixed.has('DependencyGraph.getDependents')).toBe(true);
    expect(prefixed.has('DependencyGraph.getDependencies')).toBe(true);
    expect(prefixed.has('DependencyGraph.hasCycle')).toBe(true);

    // Private members of public class
    expect(prefixed.has('CalculationEngine.graph')).toBe(true);
    expect(prefixed.has('CalculationEngine.dirtySet')).toBe(true);
    expect(prefixed.has('CalculationEngine.valueCache')).toBe(true);
    expect(prefixed.has('CalculationEngine.addressToKey')).toBe(true);
    expect(prefixed.has('CalculationEngine.markDirty')).toBe(true);
    expect(prefixed.has('CalculationEngine.recalculate')).toBe(true);

    // Internal functions
    expect(prefixed.has('hashKey')).toBe(true);
    expect(prefixed.has('parseKey')).toBe(true);
  });

  it('does not prefix any public API symbols', () => {
    const notPrefixed = new Set(result.willNotPrefix.map(d => d.qualifiedName));

    expect(notPrefixed.has('CalculationEngine')).toBe(true);
    expect(notPrefixed.has('CalculationEngine.setCellValue')).toBe(true);
    expect(notPrefixed.has('CalculationEngine.getCellValue')).toBe(true);
    expect(notPrefixed.has('CellAddress')).toBe(true);
    expect(notPrefixed.has('CellRange')).toBe(true);
    expect(notPrefixed.has('CellType')).toBe(true);
  });

  it('output engine.ts has correct renames in code', () => {
    const engineContent = fs.readFileSync(path.join(outDir, 'src', 'engine.ts'), 'utf-8');

    // Public class name preserved
    expect(engineContent).toContain('class CalculationEngine');

    // Private members prefixed
    expect(engineContent).toContain('this._graph');
    expect(engineContent).toContain('this._dirtySet');
    expect(engineContent).toContain('this._valueCache');
    expect(engineContent).toContain('_addressToKey');
    expect(engineContent).toContain('_markDirty');
    expect(engineContent).toContain('_recalculate');

    // Internal class reference prefixed
    expect(engineContent).toContain('_DependencyGraph');

    // Public methods preserved
    expect(engineContent).toContain('setCellValue');
    expect(engineContent).toContain('getCellValue');
  });

  it('output graph.ts has fully prefixed class', () => {
    const graphContent = fs.readFileSync(path.join(outDir, 'src', 'graph.ts'), 'utf-8');

    expect(graphContent).toContain('class _DependencyGraph');
    expect(graphContent).toContain('_adjacency');
    expect(graphContent).toContain('_reverseAdjacency');
    expect(graphContent).toContain('_addDependency');
    expect(graphContent).toContain('_getDependents');
    expect(graphContent).toContain('_getDependencies');
    expect(graphContent).toContain('_hasCycle');
  });

  it('output types.ts is unchanged (all public)', () => {
    const typesOriginal = fs.readFileSync(path.resolve(__dirname, '../test-project/src/types.ts'), 'utf-8');
    const typesOutput = fs.readFileSync(path.join(outDir, 'src', 'types.ts'), 'utf-8');
    expect(typesOutput).toBe(typesOriginal);
  });
});
```

**Step 2: Run e2e test**

Run: `npx vitest run tests/e2e.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/e2e.test.ts
git commit -m "feat: end-to-end test validating full pipeline"
```

---

### Task 10: Final Integration Test — CLI Execution

**Step 1: Run the tool via CLI on the test project (dry run)**

Run: `npx tsx src/cli.ts --project test-project/tsconfig.json --entry test-project/src/index.ts --outDir .mangled --dry-run`

Expected output: A table showing WILL PREFIX and WILL NOT PREFIX sections matching the expected results from the spec.

**Step 2: Run the tool for real**

Run: `npx tsx src/cli.ts --project test-project/tsconfig.json --entry test-project/src/index.ts --outDir .mangled`

Expected: "Output compiles successfully" and "Output written to" message.

**Step 3: Verify output compiles standalone**

Run: `cd .mangled && npx tsc --noEmit`
Expected: No errors.

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

**Step 5: Add .mangled to .gitignore and commit**

```bash
echo ".mangled" >> .gitignore
git add .gitignore
git commit -m "chore: add .mangled to .gitignore"
```

**Step 6: Final commit for any remaining changes**

```bash
git add -A
git commit -m "feat: ts-prefix-internals v1 complete"
```
