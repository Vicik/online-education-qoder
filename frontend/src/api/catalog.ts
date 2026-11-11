import { request } from './client';
import type {
  CourseBrief,
  CourseDetail,
  PageResult,
} from './types';

// 分页参数：page 从 1 开始，pageSize 上限 100
export interface PageParams {
  // 页码，缺省由后端决定
  page?: number;
  // 每页条数，缺省由后端决定
  pageSize?: number;
}

// 已发布课程分页列表（后端不支持搜索/筛选，前端不传额外参数）
export function listCourses(params: PageParams = {}): Promise<PageResult<CourseBrief>> {
  return request<PageResult<CourseBrief>>({
    url: '/courses',
    method: 'GET',
    params,
  });
}

// 首页推荐课程：后端返回 { courses }，此处只暴露数组
export async function getRecommendations(): Promise<CourseBrief[]> {
  // 原始响应数据
  const data = await request<{ courses: CourseBrief[] }>({
    url: '/home/recommendations',
    method: 'GET',
  });
  return data.courses;
}

// 课程详情：未发布或不存在时后端抛 3001
export function getCourseDetail(courseId: number): Promise<CourseDetail> {
  return request<CourseDetail>({
    url: `/courses/${courseId}`,
    method: 'GET',
  });
}

// 我的收藏分页（仅课程）
export function listFavorites(
  page = 1,
  pageSize = 100,
): Promise<PageResult<CourseBrief>> {
  return request<PageResult<CourseBrief>>({
    url: '/user/favorites',
    method: 'GET',
    params: { page, pageSize },
  });
}

// 收藏课程：幂等 POST，契约要求携带 Idempotency-Key
export function addFavorite(
  courseId: number,
  idempotencyKey: string,
): Promise<void> {
  return request<void>({
    url: '/favorites',
    method: 'POST',
    data: { courseId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 取消收藏：后端幂等，未收藏也不报错
export function removeFavorite(courseId: number): Promise<void> {
  return request<void>({
    url: `/favorites/${courseId}`,
    method: 'DELETE',
  });
}

// 收藏 id 全集：详情页据此判断收藏态；按 100 条一页扫描，数据量上限由用户收藏数决定
export async function listFavoriteIds(): Promise<Set<number>> {
  // 第一页同时给出总数
  const firstPage = await listFavorites(1, 100);
  // 收藏 id 集合
  const ids = new Set(firstPage.items.map((item) => item.id));
  // 剩余页数
  const totalPages = Math.ceil(firstPage.total / 100);
  for (let page = 2; page <= totalPages; page += 1) {
    // 后续页
    const nextPage = await listFavorites(page, 100);
    nextPage.items.forEach((item) => ids.add(item.id));
  }
  return ids;
}
