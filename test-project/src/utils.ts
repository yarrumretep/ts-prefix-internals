export function hashKey(sheet: string, row: number, col: number): string {
  return `${sheet}!${row}:${col}`;
}

export function parseKey(key: string): { sheet: string; row: number; col: number } {
  const [sheet, rest] = key.split('!');
  const [row, col] = rest.split(':').map(Number);
  return { sheet, row, col };
}
