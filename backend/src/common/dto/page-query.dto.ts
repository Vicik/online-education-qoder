import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// 分页查询参数类：用于接收列表接口的分页请求参数
export class PageQuery {
  // 当前页码，默认为 1，最小值为 1
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  // 每页记录数，默认为 20，范围 1-100
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  // 构造函数：支持部分属性初始化
  constructor(partial?: Partial<PageQuery>) {
    Object.assign(this, partial);
  }
}
