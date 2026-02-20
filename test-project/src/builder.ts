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
