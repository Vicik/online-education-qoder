// 邮箱格式：非空本地段 + @ + 域名
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// 密码：8–64 位可见 ASCII，至少一个字母和一个数字（无中文/空格）
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[\x21-\x7E]{8,64}$/;
// 图片允许的 MIME
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
// 图片上限 2MB
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// 邮箱校验；通过返回 null
export function validateEmail(value: string): string | null {
  return EMAIL_REGEX.test(value) ? null : '请输入正确的邮箱';
}

// 密码校验；通过返回 null
export function validatePassword(value: string): string | null {
  return PASSWORD_REGEX.test(value)
    ? null
    : '密码需 8–64 位，至少包含一个字母和一个数字，不允许中文与空格';
}

// 确认密码校验
export function validateConfirmPassword(password: string, confirm: string): string | null {
  return password === confirm ? null : '两次输入的密码不一致';
}

// 昵称最长 30 字符
export function validateNickname(value: string): string | null {
  return value.length <= 30 ? null : '昵称最多 30 个字符';
}

// 课程名称最长 40 字符
export function validateCourseName(value: string): string | null {
  return value.length <= 40 ? null : '课程名称最多 40 个字符';
}

// 章节名称最长 60 字符
export function validateChapterTitle(value: string): string | null {
  return value.length <= 60 ? null : '章节名称最多 60 个字符';
}

// 及格分 >0 且 ≤ 总分
export function validatePassScore(passScore: number, totalScore: number): string | null {
  return passScore > 0 && passScore <= totalScore ? null : '及格分需大于 0 且不超过总分';
}

// 成团人数至少 2 人
export function validateGrouponTarget(targetSize: number): string | null {
  return targetSize >= 2 ? null : '成团人数至少 2 人';
}

// 活动结束时间必须晚于开始时间
export function validateTimeRange(startAt: string, endAt: string): string | null {
  return new Date(endAt).getTime() > new Date(startAt).getTime()
    ? null
    : '结束时间必须晚于开始时间';
}

// 上传前预检：类型与大小
export function isAllowedImage(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.includes(file.type) && file.size <= MAX_IMAGE_BYTES;
}
