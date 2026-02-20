// Internal interface — NOT exported from barrel.
// Its 'items' property will be classified for rename,
// putting "items" into renamedPropNames in the second pass.
export interface InternalResult {
  items: Map<string, string[]>;
}

// Internal impl function with anonymous inline parameter type.
// The wrapper passes args directly here.
export function buildSpecImpl(args: {
  items: Record<string, string[]>;
  config: Record<string, number>;
}): InternalResult {
  const { items, config } = args;
  const result = new Map<string, string[]>();
  for (const [key, values] of Object.entries(items)) {
    result.set(key, values.slice(0, config[key] ?? values.length));
  }
  return { items: result };
}
