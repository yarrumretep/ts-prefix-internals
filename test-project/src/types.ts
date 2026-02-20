import { Identifiable } from './base.js';

export interface CellAddress extends Identifiable {
  sheet: string;
  row: number;
  col: number;
}

export interface CellRange {
  start: CellAddress;
  end: CellAddress;
}

export enum CellType {
  Number = 'number',
  Text = 'text',
  Formula = 'formula',
}
