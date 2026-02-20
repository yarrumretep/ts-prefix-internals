import { LinkMap } from './graph.js';
import { createUtilResult } from './utils.js';

// Internal interface — NOT exported from barrel.
// Its properties should be prefixed.
interface GraphSetup {
  graph: LinkMap;
  nodeCount: number;
}

// Internal function — NOT exported from barrel.
// Return uses shorthand properties that match the interface.
export function createGraphSetup(pairs: [string, string][]): GraphSetup {
  const graph = new LinkMap();
  const nodeCount = pairs.length;
  for (const [a, b] of pairs) {
    graph.connect(a, b);
  }
  return { graph, nodeCount };
}

// Also test destructuring of an internal interface
export function getNodeCount(pairs: [string, string][]): number {
  const { nodeCount } = createGraphSetup(pairs);
  return nodeCount;
}

// Test assignment destructuring target shape:
// ({ primary, token } = normalizePayload(...))
// should become ({ _primary: primary, _token: token } = ...).
type PayloadSlot = {
  primary: LinkMap;
  token: number;
};

function normalizePayload(input: PayloadSlot): { primary: LinkMap; token: number } {
  return { primary: input.primary, token: input.token };
}

export function readPayloadToken(input: PayloadSlot): number {
  let primary: LinkMap | undefined;
  let token = -1;
  ({ primary, token } = normalizePayload(input));
  if (!primary) throw new Error('primary missing');
  return token;
}

// -------------------------------------------------------------------
// Test: inline anonymous type cast with property access
//
// When code uses `as { prop: T }` with an inline type literal, TS
// creates a fresh symbol for the property.  findRenameLocations for
// GraphSetup.nodeCount won't find `.nodeCount` through the cast.
// The prefixer's second pass must catch these.
// -------------------------------------------------------------------

export function getNodeCountViaCast(pairs: [string, string][]): number {
  const result: GraphSetup = createGraphSetup(pairs);
  // Access through an anonymous inline cast — the property name must still be renamed
  return (result as { nodeCount: number }).nodeCount;
}

// -------------------------------------------------------------------
// Test: cross-file call to function with inline anonymous parameter type.
// createUtilResult is defined in utils.ts with an inline parameter type.
// findRenameLocations for those properties may not find THIS call site.
// -------------------------------------------------------------------

export function buildUtilResult(data: [string, string][]): number {
  const graph = new LinkMap();
  // Non-shorthand call — keys must be renamed
  const result = createUtilResult({
    total: data.length,
    label: 'test',
    graph: graph,
  });
  return result.total;
}

export function buildUtilResultShorthand(data: [string, string][]): number {
  const graph = new LinkMap();
  const total = data.length;
  const label = 'test';
  // Shorthand call — { graph } must expand to { _graph: graph }
  const result = createUtilResult({ total, label, graph });
  return result.total;
}
