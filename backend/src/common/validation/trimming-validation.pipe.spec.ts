import { ArgumentMetadata } from '@nestjs/common';
import { LoginDto } from '../../auth/dto/login.dto';
import {
  deepTrimStrings,
  TrimmingValidationPipe,
} from './trimming-validation.pipe';

// 管道校验元数据：按 body + LoginDto 执行
const metadata: ArgumentMetadata = { type: 'body', metatype: LoginDto };

// 构造与测试文件一致的管道选项
const pipe = new TrimmingValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

describe('deepTrimStrings', () => {
  it('递归 trim 对象与数组中的字符串', () => {
    expect(
      deepTrimStrings({
        name: '  张三  ',
        list: ['  a  ', { text: '  b  ' }],
        count: 1,
        flag: true,
        empty: null,
      }),
    ).toEqual({
      name: '张三',
      list: ['a', { text: 'b' }],
      count: 1,
      flag: true,
      empty: null,
    });
  });

  it('Date、Buffer 与类实例原样保留', () => {
    // 保持引用的 Date
    const date = new Date('2026-01-01T00:00:00Z');
    // 保持引用的二进制缓冲
    const buffer = Buffer.from('  x  ');
    // 类实例（模拟 multer 文件对象等非纯对象）
    const instance = new (class Sample {
      value = '  y  ';
    })();
    const result = deepTrimStrings({ date, buffer, instance }) as {
      date: Date;
      buffer: Buffer;
      instance: { value: string };
    };
    expect(result.date).toBe(date);
    expect(result.buffer).toBe(buffer);
    expect(result.instance).toBe(instance);
    expect(result.instance.value).toBe('  y  ');
  });
});

describe('TrimmingValidationPipe', () => {
  it('纯空格字符串 trim 后触发 IsNotEmpty', async () => {
    await expect(
      pipe.transform({ email: 'a@b.com', password: '   ' }, metadata),
    ).rejects.toBeDefined();
  });

  it('合法值 trim 后通过并返回 DTO 实例', async () => {
    const result = (await pipe.transform(
      { email: '  a@b.com  ', password: '  Passw0rd1  ' },
      metadata,
    )) as LoginDto;
    expect(result).toBeInstanceOf(LoginDto);
    expect(result.email).toBe('a@b.com');
    expect(result.password).toBe('Passw0rd1');
  });
});
