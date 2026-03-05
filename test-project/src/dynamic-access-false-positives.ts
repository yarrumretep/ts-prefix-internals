import { LinkMap } from './graph.js';

// ============================================================================
// FALSE POSITIVE 1: String-index types (Record<string, T>)
//
// When the object has a string index signature, the keys are runtime data —
// not prefixed property names. The prefixer should suppress these.
// ============================================================================

// 1a. Record<string, unknown> with plain string key
function getFromRecord(map: Record<string, unknown>, key: string): unknown {
  return map[key]; // should be SILENT — string index type
}

// 1b. for...in iteration over Record
function copyRecord(source: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key in source) {
    result[key] = source[key]; // should be SILENT — string index type (both reads and writes)
  }
  return result;
}

// 1c. Object.entries destructured key used as index
function filterRecord(obj: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== '') result[k] = v; // should be SILENT — string index type
  }
  return result;
}

// 1d. Explicit index signature (not using Record alias)
interface StringMap {
  [key: string]: number;
}
function readStringMap(map: StringMap, key: string): number {
  return map[key]; // should be SILENT — explicit string index signature
}

// ============================================================================
// FALSE POSITIVE 2: Optional-chained array access
//
// When an array is accessed through optional chaining (e.g. obj?.arr[0]),
// the type of the expression includes `| undefined`. The prefixer should
// unwrap the union to see the underlying array type.
// ============================================================================

// 2a. Optional chaining on array property
interface Container {
  items: string[];
}
function firstItem(c: Container | undefined): string | undefined {
  return c?.items[0]; // should be SILENT — array index through optional chain
}

// 2b. Nested optional chain with array
interface Nested {
  inner?: { values: number[] };
}
function nestedAccess(n: Nested): number | undefined {
  return n.inner?.values[0]; // should be SILENT — array index through optional chain
}

// 2c. Optional chaining with variable index
function itemAtIndex(c: Container | undefined, i: number): string | undefined {
  return c?.items[i]; // should be SILENT — array index through optional chain
}

// ============================================================================
// FALSE POSITIVE 3: External/library types
//
// Types from lib.dom.d.ts or node_modules have properties that will never
// be renamed. The prefixer should recognize these as external.
// ============================================================================

// 3a. Map with dynamic key (built-in generic)
function lookupMap(map: Map<string, number>, key: string): number | undefined {
  // Map.get() is a method call, not element access — this is just here for contrast.
  return map.get(key);
}

// 3b. Dynamic key on a local constant object (no internal type involved)
const LABELS: Record<string, string> = { foo: 'Foo', bar: 'Bar' };
function getLabel(name: string): string {
  return LABELS[name]; // should be SILENT — string index type on local constant
}

// ============================================================================
// FALSE POSITIVE 4: Generic type parameters
//
// When the object type is a type parameter (e.g. T, Partial<T>), the concrete
// properties aren't known statically. for...in iterates the live runtime keys,
// which will already be prefixed if the object was constructed from prefixed code.
// ============================================================================

// 4a. Generic overlay function (for...in on Partial<T>)
function overlay<T>(target: T, source: Partial<T>): void {
  for (const key in source) {
    if (source[key] !== undefined) target[key] = source[key]!; // should be SILENT — generic type parameter
  }
}

// 4b. Generic key iteration
function hasAnyKey<T extends object>(obj: T): boolean {
  for (const key in obj) {
    if (obj[key] !== undefined) return true; // should be SILENT — generic type parameter
  }
  return false;
}

// ============================================================================
// CONTROL: These SHOULD still warn (not false positives)
// ============================================================================

// Should WARN — dynamic access on object typed with internal properties
function unsafeDynamic(g: LinkMap, key: string): unknown {
  return (g as any)[key]; // should be WARN — accessing internal type dynamically
}

// Suppress unused
void getFromRecord;
void copyRecord;
void filterRecord;
void readStringMap;
void firstItem;
void nestedAccess;
void itemAtIndex;
void lookupMap;
void getLabel;
void overlay;
void hasAnyKey;
void unsafeDynamic;
