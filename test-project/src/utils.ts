import { LinkMap } from './graph.js';

export function makeKey(ns: string, x: number, y: number): string {
  return `${ns}:${x}:${y}`;
}

export function splitKey(key: string): { ns: string; x: number; y: number } {
  const parts = key.split(':');
  return { ns: parts[0], x: Number(parts[1]), y: Number(parts[2]) };
}

// -------------------------------------------------------------------
// Test: cross-file call to function with inline anonymous parameter type.
// The function and the call site are in different files.
// findRenameLocations may NOT find the call site in the other file.
// -------------------------------------------------------------------

export interface UtilResult {
  total: number;
  label: string;
}

export function createUtilResult(args: {
  total: number;
  label: string;
  graph: LinkMap;
}): UtilResult {
  for (const f of args.graph.followers('root')) {
    args.total += f.length;
  }
  return { total: args.total, label: args.label };
}
