import { ArrayNotEmpty, ArrayUnique, IsArray, IsInt } from 'class-validator';

// 宣传位排序请求：对应 openapi PromotionReorderRequest
export class ReorderPromotionDto {
  // 全部宣传课程 id 的新顺序，保存后序号从 1 连续编号
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  courseIds!: number[];
}
