// Internal base class — NOT exported from barrel
// But Processor extends it, so it becomes public via heritage clause
export interface Stringable {
  stringify(): string;
}

export class BaseProcessor implements Stringable {
  protected instanceId: string;

  constructor() {
    this.instanceId = Math.random().toString(36);
  }

  stringify(): string {
    return JSON.stringify({ instanceId: this.instanceId });
  }
}

// Internal interface extended by an exported interface
export interface Taggable {
  tag: string;
}
