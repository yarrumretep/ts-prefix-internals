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
export class DecoratedService {
  private secret: string;

  constructor() {
    this.secret = 'hidden';
  }

  @log
  processData(input: string): string {
    return input + this.secret;
  }

  internalMethod(): void {
    // not decorated, but class is decorated
  }
}
