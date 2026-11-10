// 分 → "¥12.34"
export function formatCents(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

// 元输入 → 分；非法输入返回 null
export function yuanInputToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const text = String(input).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

// 分 → 元输入回显
export function centsToYuanInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

// 售价校验：非负且不高于原价
export function isSalePriceValid(originalCents: number, saleCents: number): boolean {
  return saleCents >= 0 && saleCents <= originalCents;
}
