import { CellAddress } from './types.js';
import { DependencyGraph } from './graph.js';

export class CalculationEngine {
  private graph: DependencyGraph;
  private dirtySet: Set<string>;
  private valueCache: Map<string, number>;

  constructor() {
    this.graph = new DependencyGraph();
    this.dirtySet = new Set();
    this.valueCache = new Map();
  }

  public setCellValue(address: CellAddress, value: number): void {
    const key = this.addressToKey(address);
    this.valueCache.set(key, value);
    this.markDirty(key);
  }

  public getCellValue(address: CellAddress): number | undefined {
    const key = this.addressToKey(address);
    if (this.dirtySet.has(key)) {
      this.recalculate(key);
    }
    return this.valueCache.get(key);
  }

  private addressToKey(address: CellAddress): string {
    return `${address.sheet}!${address.row}:${address.col}`;
  }

  private markDirty(key: string): void {
    this.dirtySet.add(key);
    const dependents = this.graph.getDependents(key);
    for (const dep of dependents) {
      this.markDirty(dep);
    }
  }

  private recalculate(key: string): void {
    this.dirtySet.delete(key);
  }
}
