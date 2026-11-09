// 分转元格式化函数：将金额从分转换为元，并格式化为带人民币符号的字符串
export function formatCents(cents: number): string {
  // 将分除以 100 转换为元，保留两位小数
  return `¥${(cents / 100).toFixed(2)}`;
}
