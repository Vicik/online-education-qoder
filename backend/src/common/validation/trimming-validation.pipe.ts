import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';

// 判断是否为纯对象：原型为 Object.prototype 或 null
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 递归去除字符串首尾空白；Date、Buffer、流与类实例原样返回
export function deepTrimStrings(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((item) => deepTrimStrings(item));
  if (!isPlainObject(value)) return value;
  // 新对象承接结果，避免修改调用方传入的原始对象
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = deepTrimStrings(item);
  }
  return result;
}

// 全局验证管道：先 trim 再走 class-validator，空白字符串等价于空串
export class TrimmingValidationPipe extends ValidationPipe {
  // metadata 原样透传，仅替换待校验的值
  override transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    return super.transform(deepTrimStrings(value), metadata);
  }
}
