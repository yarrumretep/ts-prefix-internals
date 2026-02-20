// Exported class with getters/setters whose types reference internal types
import { PresenterConfig } from './format-options.js';

export class Presenter {
  private current: PresenterConfig;

  constructor(config: PresenterConfig) {
    this.current = config;
  }

  get config(): PresenterConfig {
    return this.current;
  }

  set config(value: PresenterConfig) {
    this.current = value;
  }

  apply(input: string): string {
    if (this.current.enabled) {
      return input.toUpperCase();
    }
    return input;
  }
}
