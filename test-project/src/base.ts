// Internal base class — NOT exported from barrel
// But CalculationEngine extends it, so it should become public via heritage clause
export interface Serializable {
  serialize(): string;
}

export class BaseEngine implements Serializable {
  protected engineId: string;

  constructor() {
    this.engineId = Math.random().toString(36);
  }

  serialize(): string {
    return JSON.stringify({ engineId: this.engineId });
  }
}

// Internal interface extended by an exported interface
export interface Identifiable {
  id: string;
}
