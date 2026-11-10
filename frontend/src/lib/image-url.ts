// 是否对象存储 key（非 http(s)）
export function isStorageKey(value: string | null | undefined): value is string {
  return !!value && !/^https?:\/\//i.test(value);
}

// 统一取展示地址：签名 URL 优先，其次历史 http(s) URL，key 无签名时返回 undefined
export function resolveImageUrl(
  value: string | null | undefined,
  signedUrl?: string | null,
): string | undefined {
  if (signedUrl) return signedUrl;
  if (!value) return undefined;
  return isStorageKey(value) ? undefined : value;
}
