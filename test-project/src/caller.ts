import { buildSpec } from './wrapper.js';

// Call site with object literal — triggers the second pass for the wrapper's
// anonymous parameter type because "items" is in renamedPropNames.
export function runBuild(): number {
  const result = buildSpec({
    items: { a: ['x', 'y'], b: ['z'] },
    config: { a: 1, b: 2 },
  });
  return result.count;
}
