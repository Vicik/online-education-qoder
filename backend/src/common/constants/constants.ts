// 密码正则表达式：8-64位，必须包含字母和数字，允许特殊字符，不允许中文和空格
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)[\x21-\x7E]{8,64}$/;

// 邮箱正则表达式：标准邮箱格式验证
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
