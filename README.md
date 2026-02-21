# ts-prefix-internals

[![CI](https://github.com/yarrumretep/ts-prefix-internals/actions/workflows/ci.yml/badge.svg)](https://github.com/yarrumretep/ts-prefix-internals/actions/workflows/ci.yml)

A TypeScript CLI tool that prefixes internal symbols with `_` so that terser or esbuild can aggressively mangle them via `mangleProps: /^_/`.

## The Problem

JavaScript minifiers like terser and esbuild can mangle local variable names, but they **cannot safely mangle property and method names**. They have no way to know which names are internal implementation details versus part of a public API or DOM/library interface. Mangling the wrong property name breaks your code at runtime.

This means class properties, method names, and other member identifiers ship unminified in your production bundles, often accounting for a significant portion of the remaining code size after standard minification.

## The Solution

TypeScript's compiler API *does* know which symbols are internal. It has full type information, knows about exports, class visibility modifiers, and the entire dependency graph.

`ts-prefix-internals` uses this information to:

1. **Discover your public API surface** from barrel export entry points
2. **Classify every symbol** in your project as public or internal
3. **Prefix internal symbols with `_`** using the TypeScript Language Service for safe, cross-file renaming
4. **Validate the output** compiles without errors

After prefixing, you configure your minifier to mangle everything matching `/^_/`:

```javascript
// terser
{
  mangle: {
    properties: { regex: /^_/ }
  }
}

// esbuild
{
  mangleProps: /^_/
}
```

## What Gets Prefixed

**Internal (will be prefixed):**
- Classes, functions, and variables not exported from your entry points
- Private members of exported classes
- All members of non-exported classes
- Internal interfaces, type aliases, and enums

**Public API (will NOT be prefixed):**
- Symbols exported from entry point files
- Public/protected members of exported classes
- Members of exported interfaces and enums
- Types referenced in public API signatures (followed recursively)
- Anything from `node_modules` or `.d.ts` files
- Symbols already starting with `_`

## Install

```bash
npm install -D ts-prefix-internals
```

## Usage

### CLI

```bash
# Preview what would be renamed
npx ts-prefix-internals -p tsconfig.json -e src/index.ts -o .prefixed --dry-run

# Rename and write output
npx ts-prefix-internals -p tsconfig.json -e src/index.ts -o .prefixed

# Multiple entry points
npx ts-prefix-internals -p tsconfig.json -e src/index.ts -e src/server.ts -o .prefixed
```

### Options

```
-p, --project <path>      Path to tsconfig.json (required)
-e, --entry <file>        Public API entry point file(s), repeatable (required)
-o, --outDir <dir>        Output directory for rewritten files (required)
    --prefix <string>     Prefix string (default: "_")
    --dry-run             Report what would be renamed without writing files
    --verbose             Print every rename decision with reasoning
    --skip-validation     Skip post-rename type-check
-h, --help                Show help
```

### Programmatic API

```typescript
import { prefixInternals } from 'ts-prefix-internals';

const result = await prefixInternals({
  projectPath: 'tsconfig.json',
  entryPoints: ['src/index.ts'],
  outDir: '.prefixed',
  prefix: '_',
  dryRun: false,
  verbose: false,
  skipValidation: false,
});

console.log(`Prefixed ${result.willPrefix.length} symbols`);
console.log(`Kept ${result.willNotPrefix.length} public API symbols`);

if (result.validationErrors) {
  console.error('Output has type errors:', result.validationErrors);
}
```

## Example

Given a project with a barrel export:

```typescript
// src/index.ts
export { Processor } from './engine';
export { Coord, CoordKind } from './types';
```

And an internal class not exported from the barrel:

```typescript
// src/graph.ts
export class LinkMap {
  private forward: Map<string, Set<string>>;
  connect(a: string, b: string): void { /* ... */ }
}
```

Running the tool produces:

```
WILL PREFIX (internal):
  LinkMap                  class    graph.ts:1     -> _LinkMap
  LinkMap.forward          property graph.ts:2     -> _forward
  LinkMap.connect          method   graph.ts:4     -> _connect
  Processor.links          property engine.ts:5    -> _links
  Processor.pending        property engine.ts:6    -> _pending

WILL NOT PREFIX (public API):
  Processor                class    engine.ts:4    (exported)
  Processor.setEntry       method   engine.ts:15   (public member)
  Coord                    interface types.ts:1    (exported)
  Coord.ns                 property types.ts:2     (interface member)
```

The output directory contains valid TypeScript where all internal symbols are prefixed, ready for aggressive minification.

## How It Works

1. **API Surface Discovery** (`api-surface.ts`) -- Starting from entry point barrel exports, recursively discovers every public symbol. Resolves alias chains (`export { Foo } from './foo'`), walks type signatures to find referenced types, includes public/protected class members, interface members, and enum members.

2. **Symbol Classification** (`classifier.ts`) -- Walks every source file and classifies each symbol. Uses the public API set to determine what's internal. Handles private class members, constructor parameter properties, and generates warnings for dynamic property access.

3. **Renaming** (`renamer.ts`) -- Uses the TypeScript Language Service `findRenameLocations` API for safe cross-file renaming. Collects all edits first, deduplicates, sorts in reverse order, and applies bottom-to-top to avoid position shifts.

4. **Validation** -- Compiles the output with `tsc --noEmit` to verify the renaming was safe.

## Build Pipeline Integration

A typical build pipeline using this tool:

```bash
# 1. Prefix internal symbols
npx ts-prefix-internals -p tsconfig.json -e src/index.ts -o .prefixed

# 2. Compile the prefixed source
cd .prefixed && tsc

# 3. Bundle and mangle with terser/esbuild
esbuild .prefixed/dist/index.js --bundle --minify --mangle-props=_
```

Or as package.json scripts:

```json
{
  "scripts": {
    "prefix": "ts-prefix-internals -p tsconfig.json -e src/index.ts -o .prefixed",
    "build": "npm run prefix && cd .prefixed && tsc && esbuild dist/index.js --bundle --minify --mangle-props=_"
  }
}
```

## Releasing

```bash
# patch release (default)
npm run release

# minor/major/prerelease
npm run release -- minor
```

Release script behavior:

1. Verifies you're on `main` and the working tree is clean
2. Runs tests
3. Bumps version with `npm version`
4. Pushes branch + tag

Publishing behavior:

- Tag pushes matching `v*` trigger `.github/workflows/publish.yml`
- Workflow builds/tests, verifies tag version matches `package.json`, publishes to npm, and creates a GitHub Release
- Prerelease versions (for example `1.2.0-beta.1`) publish with npm dist-tag `next`

One-time setup:

1. In npm, configure a Trusted Publisher for this GitHub repo and workflow file
2. In GitHub, create environment `npm-release` and optionally require reviewers / restrict tags
3. Protect release tags (for example `v*`) with a GitHub ruleset so only maintainers can create them

## Safety

- Uses the TypeScript Language Service for renaming (not regex/text replacement)
- Validates output compiles after renaming
- Never modifies symbols from `node_modules` or `.d.ts` files
- Skips decorated symbols (decorator name reflection would break)
- Warns on dynamic property access patterns
- Skips symbols already starting with `_`

## Requirements

- Node.js >= 18
- TypeScript >= 5.0 (as a project dependency)

## License

MIT
