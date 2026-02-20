export class DependencyGraph {
  private adjacency: Map<string, Set<string>>;
  private reverseAdjacency: Map<string, Set<string>>;

  constructor() {
    this.adjacency = new Map();
    this.reverseAdjacency = new Map();
  }

  addDependency(from: string, to: string): void {
    if (!this.adjacency.has(from)) {
      this.adjacency.set(from, new Set());
    }
    this.adjacency.get(from)!.add(to);
    if (!this.reverseAdjacency.has(to)) {
      this.reverseAdjacency.set(to, new Set());
    }
    this.reverseAdjacency.get(to)!.add(from);
  }

  getDependents(key: string): Set<string> {
    return this.reverseAdjacency.get(key) ?? new Set();
  }

  getDependencies(key: string): Set<string> {
    return this.adjacency.get(key) ?? new Set();
  }

  hasCycle(): boolean {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const dfs = (node: string): boolean => {
      visited.add(node);
      inStack.add(node);
      const deps = this.adjacency.get(node) ?? new Set();
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (dfs(dep)) return true;
        } else if (inStack.has(dep)) {
          return true;
        }
      }
      inStack.delete(node);
      return false;
    };
    for (const node of this.adjacency.keys()) {
      if (!visited.has(node)) {
        if (dfs(node)) return true;
      }
    }
    return false;
  }
}
