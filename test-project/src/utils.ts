export function makeKey(ns: string, x: number, y: number): string {
  return `${ns}:${x}:${y}`;
}

export function splitKey(key: string): { ns: string; x: number; y: number } {
  const parts = key.split(':');
  return { ns: parts[0], x: Number(parts[1]), y: Number(parts[2]) };
}
