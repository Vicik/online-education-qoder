import { request } from './client';
import type { ChapterContent, PageResult, StudyRecord } from './types';

// 学习进度：上报访问后的权威结果
export interface LearningProgress {
  // 已访问章节数 / 总章节数
  progressPercent: number;
  // 全部章节至少访问一次
  completed: boolean;
}

// 章节正文：需已购买；未购 403（3002）
export function getChapterContent(
  courseId: number,
  chapterId: number,
): Promise<ChapterContent> {
  return request<ChapterContent>({
    url: `/courses/${courseId}/chapters/${chapterId}/content`,
    method: 'GET',
  });
}

// 记录章节访问：后端 upsert 幂等，无需 Idempotency-Key
export function recordChapterVisit(
  courseId: number,
  chapterId: number,
): Promise<LearningProgress> {
  return request<LearningProgress>({
    url: `/learning/${courseId}/chapters/${chapterId}/visit`,
    method: 'POST',
  });
}

// 学习记录分页：按最近学习时间倒序
export function listStudyRecords(
  page = 1,
  pageSize = 20,
): Promise<PageResult<StudyRecord>> {
  return request<PageResult<StudyRecord>>({
    url: '/user/study-records',
    method: 'GET',
    params: { page, pageSize },
  });
}
