import { Coord } from './types.js';
import { LinkMap } from './graph.js';
import { BaseProcessor } from './base.js';

export class Processor extends BaseProcessor {
  private links: LinkMap;
  private pending: Set<string>;
  private cache: Map<string, number>;

  constructor() {
    super();
    this.links = new LinkMap();
    this.pending = new Set();
    this.cache = new Map();
  }

  public setEntry(coord: Coord, value: number): void {
    const key = this.toKey(coord);
    this.cache.set(key, value);
    this.mark(key);
  }

  public getEntry(coord: Coord): number | undefined {
    const key = this.toKey(coord);
    if (this.pending.has(key)) {
      this.refresh(key);
    }
    return this.cache.get(key);
  }

  private toKey(coord: Coord): string {
    return `${coord.ns}:${coord.x}:${coord.y}`;
  }

  private mark(key: string): void {
    this.pending.add(key);
    const deps = this.links.followers(key);
    for (const dep of deps) {
      this.mark(dep);
    }
  }

  private refresh(key: string): void {
    this.pending.delete(key);
  }
}
