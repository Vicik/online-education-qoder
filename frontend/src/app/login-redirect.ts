// 构造登录地址：保留原路径，会话过期时附带提示标记
export function buildLoginRedirect(current: string, expired: boolean): string {
  // 查询参数
  const params = new URLSearchParams({ redirect: current });
  if (expired) params.set('expired', '1');
  return `/login?${params.toString()}`;
}
