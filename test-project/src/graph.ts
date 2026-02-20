export class LinkMap {
  private forward: Map<string, Set<string>>;
  private reverse: Map<string, Set<string>>;

  constructor() {
    this.forward = new Map();
    this.reverse = new Map();
  }

  connect(a: string, b: string): void {
    if (!this.forward.has(a)) {
      this.forward.set(a, new Set());
    }
    this.forward.get(a)!.add(b);
    if (!this.reverse.has(b)) {
      this.reverse.set(b, new Set());
    }
    this.reverse.get(b)!.add(a);
  }

  followers(key: string): Set<string> {
    return this.reverse.get(key) ?? new Set();
  }

  targets(key: string): Set<string> {
    return this.forward.get(key) ?? new Set();
  }

  hasLoop(): boolean {
    const visited = new Set<string>();
    const stack = new Set<string>();
    const walk = (node: string): boolean => {
      visited.add(node);
      stack.add(node);
      const deps = this.forward.get(node) ?? new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (walk(dep)) return true;
        } else if (stack.has(dep)) {
          return true;
        }
      }
      stack.delete(node);
      return false;
    };
    for (const node of this.forward.keys()) {
      if (!visited.has(node)) {
        if (walk(node)) return true;
      }
    }
    return false;
  }
}
