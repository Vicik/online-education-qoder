import type { components } from './schema';

// OpenAPI 生成的全部 schema 别名，业务类型不手写重复 DTO
export type Schemas = components['schemas'];

// 分页响应：items 元素类型由调用方指定
export interface PageResult<T> {
  // 当前页数据
  items: T[];
  // 记录总数
  total: number;
  // 当前页码（从 1 开始）
  page: number;
  // 每页条数
  pageSize: number;
}

// 课程简要信息（首页卡片/列表/收藏）
export type CourseBrief = Schemas['CourseBrief'];

// 课程详情（含活动、可领券、章节目录）
export type CourseDetail = Schemas['CourseDetail'];

// 章节目录项（不含正文）
export type ChapterBrief = Schemas['ChapterBrief'];

// 章节正文（rich=净化 HTML；video/audio=签名地址）
export type ChapterContent = Schemas['ChapterContent'];

// 学习记录项
export type StudyRecord = Schemas['StudyRecord'];

// 进行中的拼团活动
export type GrouponActivityBrief = Schemas['GrouponActivityBrief'];

// 进行中的秒杀活动
export type FlashSaleActivityBrief = Schemas['FlashSaleActivityBrief'];

// 可领取的优惠券模板
export type CouponTemplateBrief = Schemas['CouponTemplateBrief'];
