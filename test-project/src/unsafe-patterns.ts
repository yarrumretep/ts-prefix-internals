// unsafe-patterns.ts — test cases for the three unsafe prefixer patterns
//
// Property names 'forward' and 'reverse' collide with LinkMap's private
// members, which will be renamed. These patterns demonstrate code where
// the renamer cannot track the name through the binding/key.

// --- Pattern 1: Destructured parameter with defaults ---
// The anonymous parameter type's 'forward'/'reverse' properties will be
// renamed via name-based fallback, but the binding names won't be expanded.
function configureMapping({
  forward = true,
  reverse = false,
}: {
  forward?: boolean;
  reverse?: boolean;
} = {}): string {
  return forward ? 'fwd' : reverse ? 'rev' : 'none';
}

// --- Pattern 2: Destructured return value from anonymous type ---
// Same issue: the return type's properties get renamed but the destructuring
// bindings don't get expanded because the symbols aren't directly tracked.
class MappingHelper {
  private forward: boolean = true;
  private reverse: boolean = false;

  getFlags(): { forward: boolean; reverse: boolean } {
    return { forward: this.forward, reverse: this.reverse };
  }

  summarize(): string {
    const { forward, reverse } = this.getFlags();
    return `${forward}-${reverse}`;
  }
}

// --- Pattern 3: Computed property key with keyof ---
// The string value of 'key' won't be renamed at runtime, but the interface
// properties it targets will be renamed.
interface MappingConfig {
  forward: boolean;
  reverse: boolean;
}

function applyMappingConfig(
  config: MappingConfig,
  key: keyof MappingConfig,
  value: boolean,
): MappingConfig {
  return { ...config, [key]: value };
}

// Suppress unused warnings
void configureMapping;
void MappingHelper;
void applyMappingConfig;
