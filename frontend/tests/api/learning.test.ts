import { http, HttpResponse } from 'msw';
import {
  getChapterContent,
  listStudyRecords,
  recordChapterVisit,
} from '@/api/learning';
import { server } from '../msw/server';

function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-learning' };
}

describe('learning api', () => {
  it('章节正文按课程与章节请求', async () => {
    let path = '';
    server.use(
      http.get(/\/api\/v1\/courses\/1\/chapters\/11\/content$/, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json(
          envelope({
            id: 11,
            title: '第一章',
            contentType: 'rich',
            content: '<p>正文</p>',
            sortOrder: 1,
          }),
        );
      }),
    );

    const content = await getChapterContent(1, 11);
    expect(path).toBe('/api/v1/courses/1/chapters/11/content');
    expect(content.content).toBe('<p>正文</p>');
  });

  it('上报访问返回进度', async () => {
    server.use(
      http.post(/\/api\/v1\/learning\/1\/chapters\/11\/visit$/, () =>
        HttpResponse.json(envelope({ progressPercent: 50, completed: false })),
      ),
    );

    await expect(recordChapterVisit(1, 11)).resolves.toEqual({
      progressPercent: 50,
      completed: false,
    });
  });

  it('学习记录分页', async () => {
    server.use(
      http.get(/\/api\/v1\/user\/study-records$/, () =>
        HttpResponse.json(
          envelope({
            items: [
              {
                courseId: 1,
                courseName: 'TypeScript 系统入门',
                chapterCount: 2,
                visitedCount: 1,
                lastChapterId: 11,
                lastChapterTitle: '第一章',
                progressPercent: 50,
                completed: false,
                lastVisitedAt: '2026-11-10T02:00:00.000Z',
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
          }),
        ),
      ),
    );

    const page = await listStudyRecords(1, 20);
    expect(page.items[0].courseName).toBe('TypeScript 系统入门');
  });
});
