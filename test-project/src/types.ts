import { Taggable } from './base.js';

export interface Coord extends Taggable {
  ns: string;
  x: number;
  y: number;
}

export interface CoordRange {
  from: Coord;
  to: Coord;
}

export enum CoordKind {
  Alpha = 'alpha',
  Beta = 'beta',
  Gamma = 'gamma',
}
