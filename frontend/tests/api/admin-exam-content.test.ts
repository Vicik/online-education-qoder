import { http, HttpResponse } from 'msw';
import {
  createQuestion,
  disableQuestion,
  enableQuestion,
  getAdminQuestion,
  listAdminQuestions,
  updateQuestion,
} from '@/api/admin/questions';
import {
  createExam,
  endExam,
  getAdminExam,
  listAdminExams,
  publishExam,
  updateExam,
} from '@/api/admin/exams';
import {
  createBlockedWord,
  deleteBlockedWord,
  listBlockedWords,
  updateBlockedWord,
} from '@/api/admin/blocked-words';
import { server } from '../msw/server';

// 成功信封
function envelope<T>(data: T) {
  return { code: 0, message: 'ok', data, requestId: 'r-admin-exam-content' };
}

// 题目桩（含 version 与时间）
const question = {
  id: 1,
  type: 'single',
  stem: '以下哪个是 TypeScript 类型？',
  options: [
    { key: 'A', text: 'string' },
    { key: 'B', text: 'number' },
  ],
  score: 5,
  answer: ['A'],
  analysis: 'string 是 TypeScript 的基础类型。',
  status: 'enabled',
  version: 2,
  createdAt: '2026-11-01T02:00:00.000Z',
  updatedAt: '2026-11-02T02:00:00.000Z',
};

// 考试简要桩
const exam = {
  id: 3,
  title: '期中考试',
  description: '覆盖前四章',
  durationMin: 60,
  passScore: 60,
  totalScore: 100,
  questionCount: 2,
  status: 'draft',
  publishedAt: null,
};

// 考试详情桩（含 version 与题目顺序）
const examDetail = {
  ...exam,
  version: 4,
  questionIds: [2, 1],
};

// 屏蔽词桩
const blockedWord = { id: 7, word: '代考', status: 'enabled' };

describe('admin exam content api', () => {
  it('题目列表透传题型/状态，创建带幂等键，编辑带 version，启停路径正确', async () => {
    // 列表查询参数
    let query = new URLSearchParams();
    // 创建请求体
    let createBody: unknown = null;
    // 创建幂等键
    let createKey: string | null = null;
    // 编辑请求体
    let updateBody: unknown = null;
    // 访问过的 URL
    const urls: string[] = [];

    server.use(
      http.get(/\/api\/v1\/admin\/questions$/, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(
          envelope({ items: [question], total: 1, page: 2, pageSize: 10 }),
        );
      }),
      http.post(/\/api\/v1\/admin\/questions$/, async ({ request }) => {
        createBody = await request.json();
        createKey = request.headers.get('idempotency-key');
        return HttpResponse.json(envelope(question), { status: 201 });
      }),
      http.get(/\/api\/v1\/admin\/questions\/1$/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(envelope(question));
      }),
      http.put(/\/api\/v1\/admin\/questions\/1$/, async ({ request }) => {
        updateBody = await request.json();
        return HttpResponse.json(envelope({ ...question, version: 3 }));
      }),
      http.post(/\/api\/v1\/admin\/questions\/1\/enable$/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(envelope(question));
      }),
      http.post(/\/api\/v1\/admin\/questions\/1\/disable$/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(envelope({ ...question, status: 'disabled' }));
      }),
    );

    const page = await listAdminQuestions(2, 10, 'single', 'enabled');
    expect(query.get('page')).toBe('2');
    expect(query.get('pageSize')).toBe('10');
    expect(query.get('type')).toBe('single');
    expect(query.get('status')).toBe('enabled');
    expect(page.items[0].version).toBe(2);

    await createQuestion(
      {
        type: 'single',
        stem: '以下哪个是 TypeScript 类型？',
        options: [
          { key: 'A', text: 'string' },
          { key: 'B', text: 'number' },
        ],
        answer: ['A'],
        analysis: '解析',
        score: 5,
      },
      'key-question1',
    );
    expect(createKey).toBe('key-question1');
    expect(createBody).toMatchObject({ type: 'single', score: 5, answer: ['A'] });

    const detail = await getAdminQuestion(1);
    expect(detail.answer).toEqual(['A']);

    await updateQuestion(1, {
      version: 2,
      stem: '新题干',
      options: [
        { key: 'A', text: 'string' },
        { key: 'B', text: 'number' },
      ],
      answer: ['A'],
    });
    expect(updateBody).toMatchObject({ version: 2, stem: '新题干' });

    await enableQuestion(1);
    await disableQuestion(1);
    expect(urls.some((url) => url.endsWith('/questions/1'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/questions/1/enable'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/questions/1/disable'))).toBe(true);
  });

  it('考试列表/创建/详情/编辑/发布/结束路径与载荷正确', async () => {
    // 列表查询参数
    let query = new URLSearchParams();
    // 创建请求体
    let createBody: unknown = null;
    // 创建幂等键
    let createKey: string | null = null;
    // 编辑请求体
    let updateBody: unknown = null;
    // 访问过的 URL
    const urls: string[] = [];

    server.use(
      http.get(/\/api\/v1\/admin\/exams$/, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(
          envelope({ items: [exam], total: 1, page: 1, pageSize: 10 }),
        );
      }),
      http.post(/\/api\/v1\/admin\/exams$/, async ({ request }) => {
        createBody = await request.json();
        createKey = request.headers.get('idempotency-key');
        return HttpResponse.json(envelope(examDetail), { status: 201 });
      }),
      http.get(/\/api\/v1\/admin\/exams\/3$/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(envelope(examDetail));
      }),
      http.put(/\/api\/v1\/admin\/exams\/3$/, async ({ request }) => {
        updateBody = await request.json();
        return HttpResponse.json(envelope({ ...examDetail, version: 5 }));
      }),
      http.post(/\/api\/v1\/admin\/exams\/3\/publish$/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(
          envelope({ ...examDetail, status: 'published' }),
        );
      }),
      http.post(/\/api\/v1\/admin\/exams\/3\/end$/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(envelope({ ...examDetail, status: 'ended' }));
      }),
    );

    const page = await listAdminExams(1, 10);
    expect(query.get('page')).toBe('1');
    expect(page.items[0].status).toBe('draft');

    await createExam(
      {
        title: '期中考试',
        description: '覆盖前四章',
        durationMin: 60,
        passScore: 60,
        questionIds: [2, 1],
      },
      'key-exam1234',
    );
    expect(createKey).toBe('key-exam1234');
    expect(createBody).toMatchObject({ questionIds: [2, 1], passScore: 60 });

    const detail = await getAdminExam(3);
    expect(detail.version).toBe(4);
    expect(detail.questionIds).toEqual([2, 1]);

    await updateExam(3, { version: 4, title: '期中考试（修订）' });
    expect(updateBody).toEqual({ version: 4, title: '期中考试（修订）' });

    await publishExam(3);
    await endExam(3);
    expect(urls.some((url) => url.endsWith('/exams/3/publish'))).toBe(true);
    expect(urls.some((url) => url.endsWith('/exams/3/end'))).toBe(true);
  });

  it('屏蔽词列表透传状态，新增带幂等键，更新/删除路径正确', async () => {
    // 列表查询参数
    let query = new URLSearchParams();
    // 创建请求体
    let createBody: unknown = null;
    // 创建幂等键
    let createKey: string | null = null;
    // 更新请求体
    let updateBody: unknown = null;
    // 访问过的 URL
    const urls: string[] = [];

    server.use(
      http.get(/\/api\/v1\/admin\/blocked-words$/, ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json(
          envelope({ items: [blockedWord], total: 1, page: 1, pageSize: 10 }),
        );
      }),
      http.post(/\/api\/v1\/admin\/blocked-words$/, async ({ request }) => {
        createBody = await request.json();
        createKey = request.headers.get('idempotency-key');
        return HttpResponse.json(envelope(blockedWord), { status: 201 });
      }),
      http.put(/\/api\/v1\/admin\/blocked-words\/7$/, async ({ request }) => {
        updateBody = await request.json();
        urls.push(request.url);
        return HttpResponse.json(envelope(null));
      }),
      http.delete(/\/api\/v1\/admin\/blocked-words\/7$/, ({ request }) => {
        urls.push(request.url);
        return HttpResponse.json(envelope(null));
      }),
    );

    const page = await listBlockedWords(1, 10, 'disabled');
    expect(query.get('status')).toBe('disabled');
    expect(page.items[0].word).toBe('代考');

    await createBlockedWord({ word: '代考' }, 'key-word1234');
    expect(createKey).toBe('key-word1234');
    expect(createBody).toEqual({ word: '代考' });

    await updateBlockedWord(7, { word: '替考', status: 'disabled' });
    expect(updateBody).toEqual({ word: '替考', status: 'disabled' });

    await deleteBlockedWord(7);
    expect(urls.some((url) => url.endsWith('/blocked-words/7'))).toBe(true);
  });
});
