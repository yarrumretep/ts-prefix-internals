import { buildSpecImpl } from './spec-impl.js';

// Public return type — exported from barrel
export interface SpecResult {
  count: number;
}

// Public API wrapper with anonymous inline parameter type.
// Passes args DIRECTLY to the internal impl function.
// Bug: the second pass renames this function's 'items' parameter property
// (via a call-site match) but does NOT rename the impl's matching property,
// causing a mismatch when args is passed through.
export function buildSpec(args: {
  items: Record<string, string[]>;
  config: Record<string, number>;
}): SpecResult {
  const r = buildSpecImpl(args);
  return { count: r.items.size };
}
