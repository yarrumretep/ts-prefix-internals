# Smarter Dynamic Access Diagnostics Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat warning system with a three-tier diagnostic model (silent/error/warn) that uses TypeScript's type checker to classify each `ElementAccessExpression`.

**Architecture:** Add a `Diagnostic` type to `config.ts`, rewrite `detectDynamicAccess` in `classifier.ts` to use the checker for type-aware classification, update `index.ts` and `cli.ts` to handle the new structured diagnostics with `--force` flag support. Test with a new fixture file containing array, literal, and dynamic access patterns.

**Tech Stack:** TypeScript compiler API (`checker.getTypeAtLocation`, `isArrayType`, `isTupleType`, `isStringLiteral` on types), vitest

---

### Task 1: Add `Diagnostic` type and `force` config

**Files:**
- Modify: `src/config.ts`

**Step 1: Add the `Diagnostic` interface after `RenameDecision`**

In `src/config.ts`, after the `RenameDecision` interface (line 98), add:

```typescript
export interface Diagnostic {
  level: 'error' | 'warn';
  message: string;
  file: string;
  line: number;
}
```

**Step 2: Add `force` to `PrefixConfig`**

Add `force: boolean;` to the `PrefixConfig` interface (after `skipValidation`).

**Step 3: Replace `warnings: string[]` with `diagnostics: Diagnostic[]` in `PrefixResult`**

Change the `PrefixResult` interface:

```typescript
export interface PrefixResult {
  willPrefix: RenameDecision[];
  willNotPrefix: RenameDecision[];
  diagnostics: Diagnostic[];
  outputFiles: Map<string, string>;
}
```

**Step 4: Add `--force` to `parseArgs`**

Initialize `let force = false;` in `parseArgs`. Add a case:

```typescript
case '--force':
  force = true;
  break;
```

Add `force` to the return object. Add `--force` to the help text after `--skip-validation`:

```
    --force               Downgrade dynamic-access errors to warnings
```

**Step 5: Run existing tests to verify nothing breaks yet**

Run: `npm test`
Expected: Compilation errors — tests still reference `warnings`, which is now `diagnostics`. That's expected; we fix consumers in later tasks.

**Step 6: Commit**

```
feat: add Diagnostic type, force config, and diagnostics field
```

---

### Task 2: Update `ClassificationResult` and `detectDynamicAccess` in classifier

**Files:**
- Modify: `src/classifier.ts`

**Step 1: Update imports and `ClassificationResult`**

Add `Diagnostic` to the import from `./config.js`. Change the interface:

```typescript
export interface ClassificationResult {
  willPrefix: RenameDecision[];
  willNotPrefix: RenameDecision[];
  diagnostics: Diagnostic[];
  symbolsToRename: Map<ts.Symbol, string>;
}
```

Change `const warnings: string[] = [];` to `const diagnostics: Diagnostic[] = [];` and update the return statement to `return { willPrefix, willNotPrefix, diagnostics, symbolsToRename };`.

**Step 2: Rewrite `detectDynamicAccess`**

The function needs access to `checker` and `symbolsToRename` (both already in scope of the enclosing `classifySymbols` function). Replace the entire `detectDynamicAccess` function (lines 304-319) with:

```typescript
function detectDynamicAccess(sf: ts.SourceFile): void {
  function visit(node: ts.Node): void {
    if (ts.isElementAccessExpression(node)) {
      const arg = node.argumentExpression;

      // String literals (obj["foo"]) are handled by the renamer — skip
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        ts.forEachChild(node, visit);
        return;
      }

      // Check if the object is an array/tuple — suppress entirely
      const objectType = checker.getTypeAtLocation(node.expression);
      if (
        checker.isArrayType(objectType) ||
        checker.isTupleType(objectType) ||
        objectType.getNumberIndexType() !== undefined
      ) {
        ts.forEachChild(node, visit);
        return;
      }

      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      const shortFile = sf.fileName.replace(/.*\//, '');

      // Check if the argument has a string literal type that matches a renamed symbol
      const argType = checker.getTypeAtLocation(arg);
      const literalNames = collectStringLiterals(argType);

      if (literalNames.length > 0) {
        const renamedNames = new Set<string>();
        for (const [sym] of symbolsToRename) {
          renamedNames.add(sym.getName());
        }
        const hits = literalNames.filter(n => renamedNames.has(n));
        if (hits.length > 0) {
          diagnostics.push({
            level: 'error',
            message: `Dynamic access to prefixed property '${hits.join("', '")}' at ${shortFile}:${line + 1} will break after renaming`,
            file: sf.fileName,
            line: line + 1,
          });
          ts.forEachChild(node, visit);
          return;
        }
      }

      // Fall through: warn on unresolvable dynamic access
      diagnostics.push({
        level: 'warn',
        message: `Dynamic property access at ${shortFile}:${line + 1} — may break after prefixing`,
        file: sf.fileName,
        line: line + 1,
      });
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sf, visit);
}

function collectStringLiterals(type: ts.Type): string[] {
  if (type.isStringLiteral()) {
    return [type.value];
  }
  if (type.isUnion()) {
    const results: string[] = [];
    for (const member of type.types) {
      if (member.isStringLiteral()) {
        results.push(member.value);
      }
    }
    // Only return if ALL members are string literals (otherwise we can't be sure)
    if (results.length === type.types.length) {
      return results;
    }
  }
  return [];
}
```

**Step 3: Run build to verify compilation**

Run: `npx tsc --noEmit`
Expected: Errors in `index.ts` and `cli.ts` because they still reference `warnings`. That's expected.

**Step 4: Commit**

```
feat: type-aware dynamic access detection with error/warn/silent tiers
```

---

### Task 3: Update `index.ts` to use diagnostics

**Files:**
- Modify: `src/index.ts`

**Step 1: Update the `FullResult` interface and re-exports**

Update the re-export line to include `Diagnostic`:

```typescript
export { type PrefixConfig, type PrefixResult, type Diagnostic, type RenameDecision, parseArgs } from './config.js';
```

**Step 2: Update `prefixInternals` to use `diagnostics`**

In the dry-run return block (~line 29), change `warnings: classification.warnings` to `diagnostics: classification.diagnostics`.

In the non-dry-run path (~line 41), change:
```typescript
const warnings = [...classification.warnings, ...renameResult.errors];
```
to:
```typescript
const diagnostics: Diagnostic[] = [
  ...classification.diagnostics,
  ...renameResult.errors.map(msg => ({
    level: 'warn' as const,
    message: msg,
    file: '',
    line: 0,
  })),
];
```

Add `Diagnostic` to the import from `./config.js`.

Update the return statement (~line 69) to use `diagnostics` instead of `warnings`.

**Step 3: Run build**

Run: `npx tsc --noEmit`
Expected: Errors only in `cli.ts` now.

**Step 4: Commit**

```
refactor: pipe structured diagnostics through prefixInternals
```

---

### Task 4: Update `cli.ts` to handle diagnostics and `--force`

**Files:**
- Modify: `src/cli.ts`

**Step 1: Update imports**

Change import to:
```typescript
import { parseArgs, RenameDecision, Diagnostic } from './config.js';
```

**Step 2: Rewrite `formatDryRun`**

Change the signature and body to accept `diagnostics: Diagnostic[]` instead of `warnings: string[]`:

```typescript
function formatDryRun(willPrefix: RenameDecision[], willNotPrefix: RenameDecision[], diagnostics: Diagnostic[]): string {
  const lines: string[] = [];

  lines.push('WILL PREFIX (internal):');
  for (const d of willPrefix) {
    const pad = Math.max(1, 40 - d.qualifiedName.length);
    lines.push(`  ${d.qualifiedName}${' '.repeat(pad)}${d.kind.padEnd(12)} ${d.fileName}:${d.line}    → ${d.newName}`);
  }

  lines.push('');
  lines.push('WILL NOT PREFIX (public API):');
  for (const d of willNotPrefix) {
    const pad = Math.max(1, 40 - d.qualifiedName.length);
    lines.push(`  ${d.qualifiedName}${' '.repeat(pad)}${d.kind.padEnd(12)} ${d.fileName}:${d.line}    (${d.reason})`);
  }

  const errors = diagnostics.filter(d => d.level === 'error');
  const warns = diagnostics.filter(d => d.level === 'warn');

  if (errors.length > 0) {
    lines.push('');
    lines.push(`ERRORS (${errors.length}):`);
    for (const e of errors) {
      lines.push(`  ${e.message}`);
    }
  }

  if (warns.length > 0) {
    lines.push('');
    lines.push(`WARNINGS (${warns.length}):`);
    for (const w of warns) {
      lines.push(`  ${w.message}`);
    }
  }

  return lines.join('\n');
}
```

**Step 3: Update `main` function**

Update the dry-run call (~line 43):
```typescript
console.log(formatDryRun(result.willPrefix, result.willNotPrefix, result.diagnostics));
```

Replace the warnings output block (~lines 47-52) with:
```typescript
const errors = result.diagnostics.filter(d => d.level === 'error');
const warns = result.diagnostics.filter(d => d.level === 'warn');

if (errors.length > 0) {
  console.error(`\nErrors (${errors.length}):`);
  for (const e of errors) {
    console.error(`  ${e.message}`);
  }
}
if (warns.length > 0) {
  console.log(`\nWarnings (${warns.length}):`);
  for (const w of warns) {
    console.log(`  ${w.message}`);
  }
}
```

After validation error handling, add exit-on-errors logic (before the "Output written to" line):
```typescript
if (errors.length > 0 && !config.force) {
  console.error('\nDynamic access errors detected. Use --force to proceed anyway.');
  process.exit(1);
}
```

Also update the dry-run path to exit on errors:
```typescript
if (config.dryRun) {
  console.log(formatDryRun(result.willPrefix, result.willNotPrefix, result.diagnostics));
  const errors = result.diagnostics.filter(d => d.level === 'error');
  if (errors.length > 0 && !config.force) {
    process.exit(1);
  }
}
```

**Step 4: Build and verify compilation**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

**Step 5: Commit**

```
feat: CLI shows structured errors/warnings, exits on errors unless --force
```

---

### Task 5: Add test fixture with array, literal, and dynamic access

**Files:**
- Create: `test-project/src/dynamic-access.ts`
- Modify: `test-project/src/engine.ts` (add dynamic access patterns)

**Step 1: Create the fixture file**

Create `test-project/src/dynamic-access.ts`:

```typescript
import { LinkMap } from './graph.js';

// Array indexing — should be SILENT (no diagnostic)
const items: string[] = ['a', 'b', 'c'];
const first = items[0];
for (let i = 0; i < items.length; i++) {
  const x = items[i];
}

// Dynamic access with broad string type — should be WARN
function getProperty(obj: Record<string, unknown>, key: string): unknown {
  return obj[key];
}

// Access with string literal type matching a prefixed property — should be ERROR
const graph = new LinkMap();
type GraphKey = 'forward' | 'reverse';
function accessGraphField(g: any, field: GraphKey) {
  return g[field];
}
```

Note: `forward` and `reverse` are private members of `LinkMap` and will be in the rename set.

**Step 2: Commit**

```
test: add fixture with array, literal, and dynamic access patterns
```

---

### Task 6: Write the diagnostic tier tests

**Files:**
- Create: `tests/diagnostics.test.ts`

**Step 1: Write tests for all three tiers**

```typescript
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createProgramFromConfig } from '../src/program.js';
import { discoverPublicApiSurface } from '../src/api-surface.js';
import { classifySymbols } from '../src/classifier.js';
import type { Diagnostic } from '../src/config.js';

const TEST_PROJECT = path.resolve(import.meta.dirname, '../test-project/tsconfig.json');
const TEST_ENTRY = path.resolve(import.meta.dirname, '../test-project/src/index.ts');

describe('dynamic access diagnostics', () => {
  function getDiagnostics(): Diagnostic[] {
    const program = createProgramFromConfig(TEST_PROJECT);
    const checker = program.getTypeChecker();
    const publicSymbols = discoverPublicApiSurface(program, checker, [TEST_ENTRY]);
    const result = classifySymbols(program, checker, publicSymbols, [TEST_ENTRY], '_');
    return result.diagnostics;
  }

  function diagnosticsForFile(fileName: string): Diagnostic[] {
    return getDiagnostics().filter(d => d.file.endsWith(fileName));
  }

  describe('silent tier — array/tuple access', () => {
    it('does NOT emit diagnostics for array index access', () => {
      const diags = diagnosticsForFile('dynamic-access.ts');
      // Array accesses like items[0] and items[i] should not produce diagnostics
      const arrayDiags = diags.filter(d => d.message.includes('items'));
      expect(arrayDiags).toHaveLength(0);
    });
  });

  describe('error tier — string literal type matching prefixed property', () => {
    it('emits error for access with literal type matching renamed symbol', () => {
      const diags = diagnosticsForFile('dynamic-access.ts');
      const errors = diags.filter(d => d.level === 'error');
      expect(errors.length).toBeGreaterThan(0);
      // Should mention 'forward' or 'reverse' — both are prefixed members of LinkMap
      const hitMessages = errors.filter(d => d.message.includes('forward') || d.message.includes('reverse'));
      expect(hitMessages.length).toBeGreaterThan(0);
    });
  });

  describe('warn tier — unresolvable dynamic access', () => {
    it('emits warn for broad string key access', () => {
      const diags = diagnosticsForFile('dynamic-access.ts');
      const warns = diags.filter(d => d.level === 'warn');
      expect(warns.length).toBeGreaterThan(0);
    });
  });

  describe('existing test-project files', () => {
    it('does NOT emit diagnostics for files with no dynamic access', () => {
      // engine.ts, graph.ts, types.ts etc. have no bracket access
      const engineDiags = diagnosticsForFile('engine.ts');
      expect(engineDiags).toHaveLength(0);
    });
  });
});
```

**Step 2: Run tests**

Run: `npm test`
Expected: All existing tests pass (after updating references from `warnings` to `diagnostics`), plus the new diagnostic tests pass.

**Step 3: Commit**

```
test: add diagnostic tier tests for silent, error, and warn cases
```

---

### Task 7: Update existing tests to use `diagnostics` instead of `warnings`

**Files:**
- Modify: `tests/index.test.ts`
- Modify: `tests/e2e.test.ts`
- Modify: any other test files referencing `.warnings`

**Step 1: Search for all references to `.warnings` in tests**

Find and replace `.warnings` with `.diagnostics` in test files. The tests that previously checked `result.warnings` should now check `result.diagnostics`.

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass.

**Step 3: Commit**

```
refactor: update tests to use diagnostics instead of warnings
```

---

### Task 8: Update CLI tests for `--force` flag

**Files:**
- Modify: `tests/cli.test.ts`

**Step 1: Add `--force` parsing test**

Add a test to `tests/cli.test.ts`:

```typescript
it('parses --force flag', () => {
  const config = parseArgs([
    '-p', 'tsconfig.json',
    '-e', 'src/index.ts',
    '-o', 'dist',
    '--force',
  ]);
  expect(config.force).toBe(true);
});
```

Also update the existing `parses required args` test to assert `config.force` defaults to `false`.

**Step 2: Run tests**

Run: `npm test`
Expected: All pass.

**Step 3: Commit**

```
test: add --force flag parsing test
```

---

### Task 9: Final verification and cleanup

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 2: Run a manual dry-run against the test project to verify output**

Run: `npx tsx src/cli.ts -p test-project/tsconfig.json -e test-project/src/index.ts -o /tmp/prefix-test --dry-run`
Expected: Output shows ERRORS and WARNINGS sections with properly classified diagnostics.

**Step 3: Test `--force` flag**

Run: `npx tsx src/cli.ts -p test-project/tsconfig.json -e test-project/src/index.ts -o /tmp/prefix-test --dry-run --force`
Expected: Same output but exits 0 instead of 1.

**Step 4: Commit any final adjustments**

```
chore: final verification of smarter diagnostics
```
