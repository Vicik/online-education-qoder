import { request } from '../client';
import type {
  AdminChapter,
  AdminCourseDetail,
  AdminCourseListItem,
  ChapterCreateInput,
  ChapterUpdateInput,
  CourseCreateInput,
  CourseStatus,
  CourseUpdateInput,
  CourseWriteResult,
  PageResult,
} from '../types';

// 管理端课程列表：可选状态筛选
export function listAdminCourses(
  page = 1,
  pageSize = 10,
  status?: CourseStatus,
): Promise<PageResult<AdminCourseListItem>> {
  return request<PageResult<AdminCourseListItem>>({
    url: '/admin/courses',
    method: 'GET',
    params: { page, pageSize, ...(status ? { status } : {}) },
  });
}

// 创建课程（草稿）：创建类 POST 携带幂等键
export function createCourse(
  input: CourseCreateInput,
  idempotencyKey: string,
): Promise<CourseWriteResult> {
  return request<CourseWriteResult>({
    url: '/admin/courses',
    method: 'POST',
    data: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 课程详情（含草稿/已下架与 version）
export function getAdminCourse(courseId: number): Promise<AdminCourseDetail> {
  return request<AdminCourseDetail>({
    url: `/admin/courses/${courseId}`,
    method: 'GET',
  });
}

// 编辑基本信息：version 乐观锁
export function updateCourse(
  courseId: number,
  input: CourseUpdateInput,
): Promise<CourseWriteResult> {
  return request<CourseWriteResult>({
    url: `/admin/courses/${courseId}`,
    method: 'PUT',
    data: input,
  });
}

// 发布/重新发布
export function publishCourse(courseId: number): Promise<CourseWriteResult> {
  return request<CourseWriteResult>({
    url: `/admin/courses/${courseId}/publish`,
    method: 'POST',
  });
}

// 下架课程
export function unpublishCourse(courseId: number): Promise<CourseWriteResult> {
  return request<CourseWriteResult>({
    url: `/admin/courses/${courseId}/unpublish`,
    method: 'POST',
  });
}

// 设为首页推荐
export function recommendCourse(courseId: number): Promise<CourseWriteResult> {
  return request<CourseWriteResult>({
    url: `/admin/courses/${courseId}/recommend`,
    method: 'POST',
  });
}

// 取消首页推荐
export function unrecommendCourse(courseId: number): Promise<CourseWriteResult> {
  return request<CourseWriteResult>({
    url: `/admin/courses/${courseId}/unrecommend`,
    method: 'POST',
  });
}

// 新增章节：创建类 POST 携带幂等键；类型须等于课程类型
export function addChapter(
  courseId: number,
  input: ChapterCreateInput,
  idempotencyKey: string,
): Promise<AdminChapter> {
  return request<AdminChapter>({
    url: `/admin/courses/${courseId}/chapters`,
    method: 'POST',
    data: input,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}

// 编辑章节：content 缺省保持原正文
export function updateChapter(
  courseId: number,
  chapterId: number,
  input: ChapterUpdateInput,
): Promise<AdminChapter> {
  return request<AdminChapter>({
    url: `/admin/courses/${courseId}/chapters/${chapterId}`,
    method: 'PUT',
    data: input,
  });
}

// 删除章节：服务端删除后从 1 连续重编号
export function deleteChapter(courseId: number, chapterId: number): Promise<void> {
  return request<void>({
    url: `/admin/courses/${courseId}/chapters/${chapterId}`,
    method: 'DELETE',
  });
}

// 章节排序：提交全部章节 id 的新顺序
export function reorderChapters(
  courseId: number,
  orderedChapterIds: number[],
): Promise<AdminChapter[]> {
  return request<AdminChapter[]>({
    url: `/admin/courses/${courseId}/chapters/reorder`,
    method: 'POST',
    data: { orderedChapterIds },
  });
}
