import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PageQuery } from './page-query.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function transform(value: unknown): Promise<PageQuery> {
  return pipe.transform(value, { type: 'query', metatype: PageQuery });
}

describe('PageQuery', () => {
  it('缺省时 page=1、pageSize=20', async () => {
    await expect(transform({})).resolves.toMatchObject({
      page: 1,
      pageSize: 20,
    });
  });

  it('查询串数字被转换为 number', async () => {
    await expect(
      transform({ page: '3', pageSize: '50' }),
    ).resolves.toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });

  it('pageSize 上限 100 可通过', async () => {
    await expect(transform({ pageSize: '100' })).resolves.toMatchObject({
      pageSize: 100,
    });
  });

  it('pageSize 超过 100 被拒（由过滤器映射 1001/400）', async () => {
    await expect(transform({ pageSize: 101 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('page 小于 1 被拒', async () => {
    await expect(transform({ page: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('非整数分页参数被拒', async () => {
    await expect(transform({ page: 1.5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(transform({ pageSize: 'abc' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('pageSize 小于 1 被拒', async () => {
    await expect(transform({ pageSize: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('白名单外字段被拒', async () => {
    await expect(transform({ page: 1, evil: 'x' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
