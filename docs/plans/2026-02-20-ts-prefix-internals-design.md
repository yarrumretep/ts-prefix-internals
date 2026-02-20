# ts-prefix-internals Design

## Purpose

A TypeScript CLI tool that scans a TS project and prefixes all "internal" (non-public-API) symbols with `_`, enabling aggressive property mangling by terser/esbuild via `mangleProps: /^_/`.

## Architecture

Six modules orchestrated by `index.ts`:

| Module | Responsibility |
|--------|---------------|
| `cli.ts` | CLI arg parsing (`--project`, `--entry`, `--outDir`, `--prefix`, `--dry-run`, `--verbose`, `--skip-validation`) |
| `config.ts` | Configuration types and defaults |
| `program.ts` | `ts.Program` and `ts.LanguageService` setup with in-memory host |
| `api-surface.ts` | Public API surface discovery from entry points |
| `classifier.ts` | Symbol classification (internal vs public) |
| `renamer.ts` | Rename location gathering and source rewriting |

## Core Flow

1. Parse CLI args, load tsconfig, create `ts.Program` with `ts.createProgram()`
2. From entry point files, discover public API surface: walk exports, resolve aliases via `checker.getAliasedSymbol()`, recursively follow type signatures (return types, parameter types, generic args, union/intersection members, etc.)
3. Walk all project source files (excluding `node_modules`, `.d.ts`), classify every named symbol
4. Create `ts.LanguageService` with in-memory host, call `findRenameLocations()` for each symbol to prefix
5. Collect all edits, sort reverse by position per file, apply bottom-to-top
6. Write output preserving directory structure, optionally validate with `tsc --noEmit`

## Classification Rules

**Prefix (internal):** private members of public classes, all members of non-public classes, internal classes/interfaces/enums/functions/variables not exported from entry points.

**Do NOT prefix (public):** symbols exported from entry points, public/protected members of exported classes, members of exported interfaces/enums, types referenced in public API signatures, symbols from `.d.ts`/`node_modules`, symbols already starting with `_`, `constructor`, string enum values, decorated symbols.

## Safety

- Uses TS Language Service for renaming (not naive text replacement)
- Validates output compiles with `tsc --noEmit`
- Warns on dynamic property access and string literals matching internal names

## Test Project

Spreadsheet engine: `CalculationEngine` (public class with private internals), `DependencyGraph` (internal class), `CellAddress`/`CellRange`/`CellType` (exported types), `hashKey`/`parseKey` (internal utils).

## Tech Stack

- TypeScript (latest), only dependency: `typescript` compiler API
- CLI: manual `process.argv` parsing
