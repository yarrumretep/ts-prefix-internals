// Exported class with getters/setters whose types reference internal types
import { FormatOptions } from './format-options.js';

export class Formatter {
  private currentOptions: FormatOptions;

  constructor(options: FormatOptions) {
    this.currentOptions = options;
  }

  get options(): FormatOptions {
    return this.currentOptions;
  }

  set options(value: FormatOptions) {
    this.currentOptions = value;
  }

  format(input: string): string {
    if (this.currentOptions.uppercase) {
      return input.toUpperCase();
    }
    return input;
  }
}
