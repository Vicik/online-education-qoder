// 邮箱脱敏函数：将邮箱地址的本地部分进行脱敏处理，保护用户隐私
export function maskEmail(email: string): string {
  // 获取 @ 符号的位置
  const at = email.indexOf('@');
  // 如果 @ 位置无效（在开头或结尾），返回全脱敏
  if (at <= 0 || at === email.length - 1) return '***';
  // 提取本地部分（@ 前的内容）
  const local = email.slice(0, at);
  // 提取域名部分（@ 后的内容）
  const domain = email.slice(at);
  // 如果本地部分少于 3 个字符，全部脱敏；否则保留首字母
  return local.length < 3 ? `***${domain}` : `${local[0]}***${domain}`;
}
