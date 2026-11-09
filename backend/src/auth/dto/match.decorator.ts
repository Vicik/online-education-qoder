import {
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

// Match 校验装饰器：校验当前属性值与同一对象上指定属性的值完全一致（用于确认密码）
export function Match(
  property: string,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  // 返回属性装饰器工厂，注册自定义校验规则
  return (object: object, propertyName: string | symbol) => {
    // 仅支持字符串属性名（DTO 字段均为字符串键）
    if (typeof propertyName !== 'string') return;
    registerDecorator({
      name: 'match', // 规则名称
      target: object.constructor, // 目标类
      propertyName, // 当前属性名
      constraints: [property], // 需要比较的目标属性名
      options: validationOptions, // 自定义提示等选项
      // 校验器：比较当前值与目标属性值
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          // 取出需要比较的属性名
          const [relatedProperty] = args.constraints as [string];
          // 目标对象上的对应属性值
          const relatedValue = (args.object as Record<string, unknown>)[
            relatedProperty
          ];
          // 两者严格相等才通过
          return value === relatedValue;
        },
      },
    });
  };
}
