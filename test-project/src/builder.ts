import { LinkMap } from './graph.js';

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
