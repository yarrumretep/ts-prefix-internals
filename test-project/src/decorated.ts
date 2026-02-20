// Decorated class and members — should NOT be prefixed even if internal

function sealed(constructor: Function) {
  Object.seal(constructor);
  Object.seal(constructor.prototype);
}

function log(_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
  const original = descriptor.value;
  descriptor.value = function (...args: any[]) {
    console.log(`Calling ${propertyKey}`);
    return original.apply(this, args);
  };
  return descriptor;
}

@sealed
export class DecoratedHandler {
  private hidden: string;

  constructor() {
    this.hidden = 'value';
  }

  @log
  handle(input: string): string {
    return input + this.hidden;
  }

  helperMethod(): void {
    // not decorated
  }
}
