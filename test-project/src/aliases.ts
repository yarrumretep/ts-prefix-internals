// Internal type alias not exported from barrel.
type InternalShape = {
  count: number;
  label: string;
};

// Internal function using the type alias.
export function summarizeShape(arg: InternalShape): number {
  const { count, label } = arg;
  return count + label.length;
}
