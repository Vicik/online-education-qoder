# 课程免费章节与免费课程实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让免费章节对所有访客开放、付费章节保持登录且已购门槛，并把售价为 0 的课程变为全章节开放的免费课程，同时退出交易与营销链路。

**Architecture:** 后端以 `CourseService.resolveChapterAccess` 作为唯一权威访问判定，正文接口与学习上报共用；免费课程由 `saleCents === 0` 派生，不新增课程字段。前端以服务端访问判定为准做展示与请求门控：锁定章节不发正文请求，学习页以登录/购买内联引导承接；管理端逐章设置 `isFree`。

**Tech Stack:** NestJS 11、Prisma 6、PostgreSQL、Redis、OpenAPI、React 19、Vite 7、Ant Design 5、React Router 7、TanStack Query、MSW 2、Vitest 3、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-20-course-free-chapters-design.md`

## Global Constraints

- 免费课程唯一识别条件：`Course.saleCents === 0`；不新增课程字段，课程接口也不返回 `isFree`。
- 免费章节存储：`Chapter.isFree Boolean @default(false)`，逐章控制。
- 游客可看：已发布免费课程的任意章节；已发布付费课程的免费章节。游客不记录学习进度。
- 付费章节错误语义：游客 401/2001「请先登录」；登录未购 3002/403「请先购买课程」，且不泄露章节是否存在。
- 免费课程禁止下单、拼团、秒杀、优惠券；付费课程改价为 0 时若存在券关联或未结束活动则拒绝保存。
- 非测试代码每个函数、变量写中文注释；测试文件不加注释。
- 契约优先：先改 `backend/openapi.yaml`，再实现，再执行 `cd frontend && npm run gen:api`，生成文件必须提交。
- 不推送远端；每次提交只包含本任务改动。
- 既有失败基线（非本改动引入）：`backend/src/comment/comment.service.spec.ts` 5 项、`backend/test/integration/catalog.spec.ts` 中依赖未 seed 数据的 3 项。回归时不得把这两类误判为新增失败。
- Windows 命令在 Git Bash 下执行；后端工作目录 `backend/`，前端工作目录 `frontend/`。

---

### 任务 1：契约、数据模型与文档

**Files:**
- Modify: `backend/openapi.yaml`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/<timestamp>_add_chapter_is_free/migration.sql`（由 Prisma 生成）
- Modify: `frontend/src/api/schema.d.ts`（由 `gen:api` 生成）
- Modify: `项目说明文档.md`
- Modify: `backend/接口设计文档.md`
- Modify: `frontend/前端设计框架.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-11-20-course-free-chapters-design.md` §5。
- Produces: `ChapterBrief.isFree?: boolean`、`ChapterCreateRequest.isFree?: boolean`、`ChapterUpdateRequest.isFree?: boolean` 生成类型；`chapters.is_free` 数据库列。

- [ ] **Step 1：更新 OpenAPI 的课程与章节 schema**

在 `backend/openapi.yaml` 中完成以下精确修改：

1. `CourseBrief.saleCents`（约 242 行）改为：

```yaml
        saleCents: { type: integer, description: 售价（分）；为 0 即免费课程，全部章节公开且不可下单/参与拼团、秒杀、优惠券 }
```

2. `ChapterBrief`（约 249-257 行）在 `sortOrder` 后新增 `isFree`，并更新 `visited` 描述：

```yaml
        sortOrder: { type: integer }
        isFree: { type: boolean, description: 免费试看章节；免费课程下所有章节均可看 }
        visited: { type: boolean, description: 是否已播放完成；仅登录用户返回 }
        content: { type: string, nullable: true, description: 媒体 key；仅管理端详情返回，用于编辑回填 }
```

3. `CourseDetail.chapters.description`（约 269 行）改为：

```yaml
              description: 免费章节/免费课程对所有人开放；付费章节需登录且已购买才能读取正文
```

4. `ChapterContent.description`（约 277 行）改为：

```yaml
      description: 免费章节与免费课程公开返回；付费章节需登录且已购买（游客 401，未购 403）
```

5. `ChapterCreateRequest`（约 310-316 行）新增可选字段：

```yaml
        isFree: { type: boolean, description: 免费试看；默认 false }
```

6. `ChapterUpdateRequest`（约 317-321 行）新增可选字段：

```yaml
        isFree: { type: boolean, description: 传入即设置是否免费试看；不传表示保持不变 }
```

7. `GET /courses/{courseId}/chapters/{cid}/content`（约 986-1001 行）加 `security: []` 并更新 summary：

```yaml
  /courses/{courseId}/chapters/{cid}/content:
    get:
      tags: [catalog]
      summary: 章节正文（免费章节/免费课程公开；付费章节需登录且已购买）
      security: []
      parameters:
        - { $ref: '#/components/parameters/courseId' }
        - { $ref: '#/components/parameters/chapterId' }
      responses:
        '200':
          description: 'data: ChapterContent'
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Envelope' }
        '401': { $ref: '#/components/responses/Err401' }
        '403': { $ref: '#/components/responses/Err403' }
        '404': { $ref: '#/components/responses/Err404' }
```

8. 管理端优惠券创建接口（约 1459 行 summary、1471 行 422 描述）、拼团创建接口（约 1766 行 summary、1779 行 422 描述）、秒杀创建接口（约 1885 行 summary、1897 行 422 描述）补充限制：
   - 优惠券：summary 追加「免费课程不可关联」，422 描述追加「或包含免费课程」。
   - 拼团：summary 追加「免费课程不可创建」，422 描述追加「或课程为免费课程」。
   - 秒杀：summary 追加「免费课程不可创建」，422 描述追加「或课程为免费课程」。

- [ ] **Step 2：更新 Prisma schema**

在 `backend/prisma/schema.prisma` 的 `Chapter` 模型中，`sortOrder` 后新增：

```prisma
  isFree      Boolean    @default(false) // 免费试看：已发布付费课程的该章节对所有人开放
```

- [ ] **Step 3：生成迁移并重新生成 Prisma Client**

Run:

```bash
cd backend && npx prisma migrate dev --name add_chapter_is_free && npx prisma generate
```

Expected: 生成 `backend/prisma/migrations/<timestamp>_add_chapter_is_free/migration.sql`，内容包含：

```sql
ALTER TABLE "chapters" ADD COLUMN "is_free" BOOLEAN NOT NULL DEFAULT false;
```

若不包含 `DEFAULT false` 或出现其他表变更，停止并修正 schema 后重新生成。

- [ ] **Step 4：重新生成前端契约类型**

Run:

```bash
cd frontend && npm run gen:api
```

Expected: `frontend/src/api/schema.d.ts` 中 `ChapterBrief`、`ChapterCreateRequest`、`ChapterUpdateRequest` 出现 `isFree?: boolean`。

- [ ] **Step 5：同步产品说明文档**

修改仓库根目录 `项目说明文档.md`：

1. §6.2 课程浏览与详情：
   - 「查看章节正文内容」权限行改为「免费章节/免费课程：所有人；付费章节：登录且已购买」。
   - 主按钮行改为「免费课程或已购：立即学习；否则立即购买」。
   - 售价行改为「售价为 0 即免费课程：全部章节公开，且不可下单、拼团、秒杀、关联优惠券」。
2. §6.3 课程管理：
   - 章节维护增加「免费试看」开关，说明「已发布付费课程的该章节对所有人开放」。
   - 免费课程在基本信息与章节维护页展示提示。
   - 增加改价护栏：付费课程改价为 0 时，若存在券关联或未开始/进行中的拼团、秒杀，拒绝保存并提示先解除关联或结束活动。
3. §6.4 课程学习：
   - 游客可进入学习页观看免费章节/免费课程；登录未购用户可看试看章节并记录进度；免费课程无需购买。
   - 锁定章节在页面内展示登录或购买引导，不发正文请求；游客播放结束不上报。
4. §6.5/§6.6/§6.7：优惠券、拼团、秒杀分别增加「免费课程不可关联/创建」。
5. §9 演示数据：TypeScript 课程第一章标记为免费试看。

- [ ] **Step 6：同步接口设计文档**

修改 `backend/接口设计文档.md`：

1. 章节正文接口权限（约 343 行）由「登录且已购」改为「免费章节与免费课程公开；付费章节需登录且已购买」。
2. 学习上报权限（约 344 行）改为「需登录；免费章节/免费课程登录后可上报，游客不可上报」。
3. 管理端章节新增/编辑请求体（约 360-361 行）补充 `isFree?: boolean`。
4. 正文权限说明（约 570 行）同步为免费开放与登录已购两档。

- [ ] **Step 7：同步前端设计框架**

修改 `frontend/前端设计框架.md`：

1. 第 27 行非目标列表中移除「免费试看」。
2. 路由表 `/learning/:courseId`（约 161 行）权限改为「公开；付费章节需登录且已购」。
3. 3002 行为说明（约 262 行）改为「页面内展示购买引导，不整页跳转」。
4. 课程详情/学习页章节表（约 385-386 行）补充「试看」「锁定」两种状态。
5. 管理端课程工作区（约 417 行）补充章节「免费试看」开关与免费课程提示。
6. 业务规则映射（约 511-521 行）补充免费章节、免费课程、锁定引导与免费课程营销限制。

- [ ] **Step 8：验证生成类型可编译**

Run:

```bash
cd frontend && npm run typecheck
```

Expected: PASS（本步只校验契约变更未破坏现有类型）。

- [ ] **Step 9：提交**

```bash
git add backend/openapi.yaml backend/prisma/schema.prisma backend/prisma/migrations frontend/src/api/schema.d.ts 项目说明文档.md backend/接口设计文档.md frontend/前端设计框架.md
git commit -m "feat(contract): 新增章节免费试看与免费课程契约"
```

---

### 任务 2：后端统一访问判定、公开正文与学习上报复用

**Files:**
- Modify: `backend/src/catalog/course.service.ts`
- Modify: `backend/src/catalog/course.controller.ts`
- Modify: `backend/src/learning/learning.service.ts`
- Modify: `backend/src/catalog/course.service.spec.ts`
- Modify: `backend/src/learning/learning.service.spec.ts`

**Interfaces:**
- Consumes: 任务 1 的 `Chapter.isFree` 字段。
- Produces:
  - `CourseService.resolveChapterAccess(userId: number | null, courseId: number, chapterId: number): Promise<{ chapter: Chapter; access: 'free' | 'paid' }>`
  - `CourseService.getChapterContent(userId: number | null, courseId: number, chapterId: number): Promise<ChapterContent>`
  - `CourseService.getDetail` 的 `chapters[].isFree` 与「所有登录用户可拿到 visited」。
  - `GET /courses/:courseId/chapters/:cid/content` 变为公开路由。

- [ ] **Step 1：先改单测到新契约（预期失败）**

`backend/src/catalog/course.service.spec.ts`：

1. `setup()` 的 `course` 替代对象增加 `findUnique: jest.fn()`。
2. `getDetail` 相关用例的章节 mock 增加 `isFree` 字段，`chapter.findMany` 的 select 断言增加 `isFree: true`；用户端与 `CHAPTER_ADMIN_SELECT` 两处都要加。
3. 把「未购用户即使登录也不返回已学标记」整段替换为：

```ts
  it('登录未购用户也返回已学标记', async () => {
    const { prisma, service } = setup();
    prisma.course.findFirst.mockResolvedValue({ ...courseRow, detailRich: null });
    prisma.chapter.findMany.mockResolvedValue([
      { id: 1, title: '第一章', contentType: 'video', sortOrder: 1, isFree: false },
      { id: 2, title: '第二章', contentType: 'video', sortOrder: 2, isFree: true },
    ]);
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);
    prisma.couponTemplate.findMany.mockResolvedValue([]);
    prisma.learningRecord.findMany.mockResolvedValue([{ chapterId: 2 }]);

    const detail = await service.getDetail(1, false, 9);

    expect(prisma.learningRecord.findMany).toHaveBeenCalledWith({
      where: { userId: 9, courseId: 1 },
      select: { chapterId: true },
    });
    expect(detail.chapters[1]).toMatchObject({ id: 2, visited: true, isFree: true });
  });
```

4. 新增免费课程详情用例：

```ts
  it('免费课程不查询可领券并返回空数组', async () => {
    const { prisma, service } = setup();
    prisma.course.findFirst.mockResolvedValue({
      ...courseRow,
      saleCents: 0,
      detailRich: null,
    });
    prisma.chapter.findMany.mockResolvedValue([
      { id: 1, title: '第一章', contentType: 'video', sortOrder: 1, isFree: false },
    ]);
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);

    const detail = await service.getDetail(1);

    expect(prisma.couponTemplate.findMany).not.toHaveBeenCalled();
    expect(detail.claimableCoupons).toEqual([]);
  });
```

5. 新增完整的访问矩阵 describe：

```ts
describe('CourseService.resolveChapterAccess', () => {
  const FREE_COURSE = { id: 1, status: 'published', saleCents: 0 };
  const PAID_COURSE = { id: 1, status: 'published', saleCents: 9900 };
  const FREE_CHAPTER = {
    id: 1,
    courseId: 1,
    title: '第一章',
    contentType: 'video',
    content: null,
    sortOrder: 1,
    isFree: true,
  };
  const PAID_CHAPTER = { ...FREE_CHAPTER, id: 2, title: '第二章', isFree: false };

  it('课程不存在抛 3001/404', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(null);
    prisma.chapter.findFirst.mockResolvedValue(null);

    await expect(service.resolveChapterAccess(null, 99, 1)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });

  it('游客可看免费课程的任意章节', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(FREE_COURSE);
    prisma.chapter.findFirst.mockResolvedValue(PAID_CHAPTER);

    await expect(service.resolveChapterAccess(null, 1, 2)).resolves.toEqual({
      chapter: PAID_CHAPTER,
      access: 'free',
    });
  });

  it('游客可看付费课程的免费章节', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PAID_COURSE);
    prisma.chapter.findFirst.mockResolvedValue(FREE_CHAPTER);

    await expect(service.resolveChapterAccess(null, 1, 1)).resolves.toEqual({
      chapter: FREE_CHAPTER,
      access: 'free',
    });
  });

  it('游客看付费章节抛 2001/401，不泄露章节是否存在', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PAID_COURSE);
    prisma.chapter.findFirst.mockResolvedValue(PAID_CHAPTER);

    await expect(service.resolveChapterAccess(null, 1, 2)).rejects.toMatchObject({
      bizCode: 2001,
      status: 401,
      message: '请先登录',
    });
  });

  it('登录未购看付费章节抛 3002/403', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PAID_COURSE);
    prisma.chapter.findFirst.mockResolvedValue(PAID_CHAPTER);
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(false);

    await expect(service.resolveChapterAccess(9, 1, 2)).rejects.toMatchObject({
      bizCode: 3002,
      status: 403,
      message: '请先购买课程',
    });
  });

  it('已购用户看付费章节返回 paid，下架课程也放行', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({
      ...PAID_COURSE,
      status: 'unpublished',
    });
    prisma.chapter.findFirst.mockResolvedValue(PAID_CHAPTER);
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);

    await expect(service.resolveChapterAccess(9, 1, 2)).resolves.toEqual({
      chapter: PAID_CHAPTER,
      access: 'paid',
    });
  });

  it('已购用户章节不存在抛 3001/404', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PAID_COURSE);
    prisma.chapter.findFirst.mockResolvedValue(null);
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);

    await expect(service.resolveChapterAccess(9, 1, 99)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });

  it('免费开放条件满足但章节不存在抛 3001/404', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(FREE_COURSE);
    prisma.chapter.findFirst.mockResolvedValue(null);

    await expect(service.resolveChapterAccess(null, 1, 99)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });

  it('未发布付费课程对游客抛 2001/401', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({
      ...PAID_COURSE,
      status: 'draft',
    });
    prisma.chapter.findFirst.mockResolvedValue(FREE_CHAPTER);

    await expect(service.resolveChapterAccess(null, 1, 1)).rejects.toMatchObject({
      bizCode: 2001,
      status: 401,
    });
  });
});
```

6. `getChapterContent` 的既有用例改为 mock `course.findUnique` 与章节；删除「不校验课程状态」断言。完整替换该 describe：

```ts
describe('CourseService.getChapterContent', () => {
  const PUBLISHED_PAID = { id: 1, status: 'published', saleCents: 9900 };

  it('游客看付费章节抛 2001/401', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_PAID);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 2,
      title: '第二章',
      contentType: 'video',
      content: 'videos/ch2.mp4',
      sortOrder: 2,
      isFree: false,
    });

    await expect(service.getChapterContent(null, 1, 2)).rejects.toMatchObject({
      bizCode: 2001,
      status: 401,
    });
  });

  it('游客可读取免费章节正文', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_PAID);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 1,
      title: '第一章',
      contentType: 'video',
      content: 'videos/ch1.mp4',
      sortOrder: 1,
      isFree: true,
    });

    await expect(service.getChapterContent(null, 1, 1)).resolves.toEqual({
      id: 1,
      title: '第一章',
      contentType: 'video',
      content: 'https://signed/videos/ch1.mp4',
      sortOrder: 1,
    });
  });

  it('登录未购看付费章节抛 3002/403', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_PAID);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 2,
      title: '第二章',
      contentType: 'video',
      content: 'videos/ch2.mp4',
      sortOrder: 2,
      isFree: false,
    });
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(false);

    await expect(service.getChapterContent(9, 1, 2)).rejects.toMatchObject({
      bizCode: 3002,
      status: 403,
    });
  });

  it('已购返回签名正文', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_PAID);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 1,
      title: '第一章',
      contentType: 'video',
      content: 'videos/ch1.mp4',
      sortOrder: 1,
      isFree: false,
    });
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);

    await expect(service.getChapterContent(9, 1, 1)).resolves.toMatchObject({
      content: 'https://signed/videos/ch1.mp4',
    });
    expect(prisma.course.findUnique).toHaveBeenCalledWith({
      where: { id: 1 },
      select: { id: true, status: true, saleCents: true },
    });
  });

  it('章节正文为空时返回 null', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_PAID);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 3,
      title: '空章',
      contentType: 'video',
      content: null,
      sortOrder: 3,
      isFree: true,
    });

    await expect(service.getChapterContent(null, 1, 3)).resolves.toMatchObject({
      content: null,
    });
  });

  it('已购但章节不存在抛 3001/404', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(PUBLISHED_PAID);
    prisma.chapter.findFirst.mockResolvedValue(null);
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);

    await expect(service.getChapterContent(9, 1, 99)).rejects.toMatchObject({
      bizCode: 3001,
      status: 404,
    });
  });

  it('下架课程已购仍可访问正文', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({
      ...PUBLISHED_PAID,
      status: 'unpublished',
    });
    prisma.chapter.findFirst.mockResolvedValue({
      id: 2,
      title: '第二章',
      contentType: 'video',
      content: 'videos/ch2.mp4',
      sortOrder: 2,
      isFree: false,
    });
    jest.spyOn(service, 'hasPaidAccess').mockResolvedValue(true);

    await expect(service.getChapterContent(9, 1, 2)).resolves.toMatchObject({
      title: '第二章',
      content: 'https://signed/videos/ch2.mp4',
    });
  });
});
```

`backend/src/learning/learning.service.spec.ts`：

1. `setup()` 改为：

```ts
  const prisma = {
    chapter: { count: jest.fn(), groupBy: jest.fn() },
    learningRecord: {
      upsert: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
    },
    course: { findMany: jest.fn() },
    order: { groupBy: jest.fn().mockResolvedValue([]) },
  };
  const courseService = {
    resolveChapterAccess: jest.fn().mockResolvedValue({
      chapter: { id: 1 },
      access: 'paid',
    }),
  };
```

2. 删除 `recordVisit` 用例中所有 `prisma.chapter.findFirst` 的 mock 与断言，改为断言统一判定入参：

```ts
    expect(courseService.resolveChapterAccess).toHaveBeenCalledWith(1, 1, 1);
```

3. 「未购访问抛 3002/403」改为：

```ts
  it('未购访问抛 3002/403', async () => {
    const { prisma, courseService, service } = setup();
    courseService.resolveChapterAccess.mockRejectedValue({
      bizCode: 3002,
      status: 403,
    });

    await expect(service.recordVisit(1, 1, 1)).rejects.toMatchObject({
      bizCode: 3002,
      status: 403,
    });
    expect(prisma.learningRecord.upsert).not.toHaveBeenCalled();
  });
```

4. 「章节不属于该课程抛 3001/404」改为 mock `resolveChapterAccess` 拒绝 `{ bizCode: 3001, status: 404 }`。

5. 新增试看用例：

```ts
  it('试看章节可上报并计入进度', async () => {
    const { prisma, courseService, service } = setup();
    courseService.resolveChapterAccess.mockResolvedValue({
      chapter: { id: 1 },
      access: 'free',
    });
    prisma.chapter.count.mockResolvedValue(2);
    prisma.learningRecord.upsert.mockResolvedValue({});
    prisma.learningRecord.count.mockResolvedValue(1);

    await expect(service.recordVisit(9, 1, 1)).resolves.toEqual({
      progressPercent: 50,
      completed: false,
    });
    expect(courseService.resolveChapterAccess).toHaveBeenCalledWith(9, 1, 1);
    expect(prisma.learningRecord.upsert).toHaveBeenCalled();
  });
```

- [ ] **Step 2：运行单测确认失败**

Run:

```bash
cd backend && npm test -- --testPathPattern="course.service.spec|learning.service.spec"
```

Expected: 编译失败或断言失败，原因是 `resolveChapterAccess` 尚不存在、正文仍要求已购。

- [ ] **Step 3：实现 CourseService**

在 `backend/src/catalog/course.service.ts`：

1. `@prisma/client` 导入增加 `Chapter` 类型。
2. `ChapterBrief` 增加字段并更新 `visited` 注释：

```ts
  sortOrder: number; // 章节序号
  isFree: boolean; // 免费试看：免费课程的章节同样可看
  visited?: boolean; // 是否已学完：已登录用户返回
```

3. `CHAPTER_BRIEF_SELECT` 增加 `isFree: true`。
4. `getDetail` 修改：

```ts
    // 是否返回章节已学标记：所有登录用户均返回（有记录才显示）
    const visitedViewerId = userId;
```

删除 `canSeeVisited` 与 `hasPaidAccess` 调用；`visitedViewerId !== undefined` 分支保持不变。可领券查询从 `Promise.all` 中移出，改为：

```ts
    // 免费课程不展示可领券，避免出现无法使用的营销入口
    const coupons =
      course.saleCents === 0
        ? []
        : await this.prisma.couponTemplate.findMany({
            where: {
              status: 'enabled',
              startAt: { lte: now },
              endAt: { gte: now },
              courses: { some: { courseId } },
            },
            select: {
              id: true,
              name: true,
              discountCents: true,
              startAt: true,
              endAt: true,
              totalQty: true,
              claimedCount: true,
              status: true,
              courses: { select: { courseId: true } },
            },
            orderBy: { createdAt: 'desc' },
          });
```

同步从原 `Promise.all` 数组与解构中移除 `coupons`。

5. 在 `hasPaidAccess` 之后新增统一判定：

```ts
  // 章节访问结果：命中的章节与访问来源
  export interface ChapterAccessResult {
    chapter: Chapter; // 命中的章节
    access: 'free' | 'paid'; // free=免费开放；paid=已购开放
  }
```

该接口放在 `ChapterContent` 接口附近、类外部。类内新增方法：

```ts
  // 解析章节访问权限：未授权按 404/401/3002 抛出，不泄露付费章节是否存在
  async resolveChapterAccess(
    userId: number | null,
    courseId: number,
    chapterId: number,
  ): Promise<ChapterAccessResult> {
    // 并行读取课程基础信息与目标章节
    const [course, chapter] = await Promise.all([
      this.prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, status: true, saleCents: true },
      }),
      this.prisma.chapter.findFirst({ where: { id: chapterId, courseId } }),
    ]);
    // 课程不存在
    if (!course) {
      throw new BizException(ErrorCode.COURSE_NOT_FOUND, '课程不存在', 404);
    }
    // 已购用户：不受课程状态与试看标记限制
    if (userId !== null && (await this.hasPaidAccess(userId, courseId))) {
      if (!chapter) {
        throw new BizException(ErrorCode.COURSE_NOT_FOUND, '章节不存在', 404);
      }
      return { chapter, access: 'paid' };
    }
    // 免费开放：已发布且（免费课程或免费试看章节）
    const freeOpen =
      course.status === 'published' &&
      (course.saleCents === 0 || chapter?.isFree === true);
    if (freeOpen) {
      if (!chapter) {
        throw new BizException(ErrorCode.COURSE_NOT_FOUND, '章节不存在', 404);
      }
      return { chapter, access: 'free' };
    }
    // 游客引导登录；登录未购引导购买
    if (userId === null) {
      throw new BizException(ErrorCode.UNAUTHORIZED, '请先登录', 401);
    }
    throw new BizException(ErrorCode.NOT_PURCHASED, '请先购买课程', 403);
  }
```

6. `getChapterContent` 改为：

```ts
  // 章节正文：免费章节/免费课程公开；付费章节需登录且已购买；下架课程的已购用户仍可访问
  async getChapterContent(
    userId: number | null,
    courseId: number,
    chapterId: number,
  ): Promise<ChapterContent> {
    // 统一访问判定：命中章节随结果返回
    const { chapter } = await this.resolveChapterAccess(
      userId,
      courseId,
      chapterId,
    );

    // 视频/音频 key 换签名地址，历史 http 原样
    const content =
      chapter.content === null
        ? null
        : await this.storage.resolveUrl(chapter.content);

    return {
      id: chapter.id,
      title: chapter.title,
      contentType: chapter.contentType,
      content,
      sortOrder: chapter.sortOrder,
    };
  }
```

- [ ] **Step 4：公开正文路由并复用判定**

`backend/src/catalog/course.controller.ts` 的内容路由改为：

```ts
  // 章节正文（免费章节/免费课程公开；付费章节需登录且已购买）
  @Public()
  @Get(':courseId/chapters/:cid/content')
  content(
    @CurrentUser() user: CurrentUserInfo | null,
    @Param('courseId', ParseIntPipe) courseId: number,
    @Param('cid', ParseIntPipe) chapterId: number,
  ) {
    return this.courses.getChapterContent(user?.userId ?? null, courseId, chapterId);
  }
```

`backend/src/learning/learning.service.ts`：

1. 删除不再使用的 `ErrorCode`、`BizException` 导入。
2. 构造函数注释改为「注入 Prisma 与课程服务（复用章节访问判定）」。
3. `recordVisit` 开头改为：

```ts
    // 统一访问判定：游客/未购/锁定章节在此抛出 401/3002
    await this.courseService.resolveChapterAccess(userId, courseId, chapterId);

    // 课程总章节数
    const total = await this.prisma.chapter.count({ where: { courseId } });
```

删除原来的 `hasPaidAccess` 校验、`chapter.findFirst` 查询与 `total === 0` 不可达分支。`chapter.count` 之后的逻辑保持不变。

- [ ] **Step 5：运行单测确认通过**

Run:

```bash
cd backend && npm test -- --testPathPattern="course.service.spec|learning.service.spec"
```

Expected: PASS。

- [ ] **Step 6：编译后端**

Run:

```bash
cd backend && npm run build
```

Expected: PASS。

- [ ] **Step 7：提交**

```bash
git add backend/src/catalog/course.service.ts backend/src/catalog/course.controller.ts backend/src/learning/learning.service.ts backend/src/catalog/course.service.spec.ts backend/src/learning/learning.service.spec.ts
git commit -m "feat(catalog): 统一章节访问判定并公开免费章节正文"
```

---

### 任务 3：管理端章节 isFree 写入与回读

**Files:**
- Modify: `backend/src/catalog/dto/create-chapter.dto.ts`
- Modify: `backend/src/catalog/dto/update-chapter.dto.ts`
- Modify: `backend/src/catalog/chapter.admin.service.ts`
- Modify: `backend/src/catalog/dto/create-chapter.dto.spec.ts`
- Modify: `backend/src/catalog/dto/update-chapter.dto.spec.ts`
- Modify: `backend/src/catalog/chapter.admin.service.spec.ts`

**Interfaces:**
- Consumes: 任务 2 的 `Chapter.isFree` Prisma 字段。
- Produces: 管理端章节创建/编辑/列表均支持 `isFree`。

- [ ] **Step 1：先补 DTO 单测（预期失败）**

`create-chapter.dto.spec.ts` 新增：

```ts
  it('isFree 为布尔值时通过', async () => {
    await expect(validate(build({ isFree: true }))).resolves.toHaveLength(0);
    await expect(validate(build({ isFree: false }))).resolves.toHaveLength(0);
  });

  it('isFree 非布尔值被拒', async () => {
    await expect(validate(build({ isFree: 'yes' }))).resolves.not.toHaveLength(0);
  });
```

`update-chapter.dto.spec.ts` 新增：

```ts
  it('isFree 缺省或布尔值均可通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
    await expect(validate(build({ isFree: true }))).resolves.toHaveLength(0);
  });

  it('isFree 非布尔值被拒', async () => {
    await expect(validate(build({ isFree: 1 }))).resolves.not.toHaveLength(0);
  });
```

Run:

```bash
cd backend && npm test -- --testPathPattern="create-chapter.dto.spec|update-chapter.dto.spec"
```

Expected: FAIL（`isFree` 被 whitelist 丢弃或非布尔值未被拒）。

- [ ] **Step 2：实现 DTO**

`create-chapter.dto.ts`：

```ts
import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
```

类内新增：

```ts
  // 是否免费试看：默认 false
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;
```

`update-chapter.dto.ts` 导入 `IsBoolean`、`IsOptional`，类内新增：

```ts
  // 是否免费试看：传入即设置
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;
```

- [ ] **Step 3：实现管理端服务**

`chapter.admin.service.ts`：

1. `ChapterBriefRow` 增加 `isFree: boolean; // 是否免费试看`。
2. `addChapter` 的 `prisma.chapter.create.data` 增加 `isFree: dto.isFree ?? false`。
3. `updateChapter` 的 update data 增加：

```ts
        ...(dto.isFree === undefined ? {} : { isFree: dto.isFree }),
```

4. `listChapters` 的 select 增加 `isFree: true`。

- [ ] **Step 4：补服务单测**

`chapter.admin.service.spec.ts`：

1. `addChapter` 用例「新章节 sortOrder = max+1」中，期望的 create data 增加 `isFree: false`。
2. 新增创建试看章节用例：

```ts
  it('新增章节可标记免费试看', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_DRAFT);
    prisma.chapter.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } });
    prisma.chapter.create.mockImplementation(({ data }) => Promise.resolve(data));

    const created = await service.addChapter(1, {
      title: '试看章节',
      contentType: 'video',
      content: 'videos/trial.mp4',
      isFree: true,
    });

    expect(prisma.chapter.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ isFree: true }),
    });
    expect(created).toMatchObject({ isFree: true });
  });
```

3. 新增编辑用例：

```ts
  it('编辑章节可设置或取消免费试看', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(VIDEO_DRAFT);
    prisma.chapter.findFirst.mockResolvedValue({
      id: 1,
      courseId: 1,
      title: '第一章',
      contentType: 'video',
      content: 'videos/a.mp4',
      sortOrder: 1,
      isFree: false,
    });
    prisma.chapter.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: 1, isFree: false, ...data }),
    );

    const updated = await service.updateChapter(1, 1, { isFree: true });

    expect(prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isFree: true },
    });
    expect(updated.isFree).toBe(true);
  });
```

4. 新增目录回读用例：

```ts
  it('章节列表返回 isFree', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1, type: 'video', status: 'draft' });
    prisma.chapter.findMany.mockResolvedValue([
      { id: 1, title: '第一章', contentType: 'video', sortOrder: 1, isFree: true },
    ]);

    const after = await service.deleteChapter(1, 2);

    expect(prisma.chapter.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ isFree: true }),
      }),
    );
    expect(after).toEqual([
      expect.objectContaining({ id: 1, isFree: true }),
    ]);
  });
```

> 说明：`listChapters` 为私有方法，通过 `deleteChapter` 的审计前快照间接验证；`deleteChapter` 其余依赖需按现有用例补齐 `chapter.findFirst`、`chapter.delete`、`chapter.updateMany`、`chapter.update` 的 mock。若现有测试已覆盖删除流程，优先在已有「已下架课程可删除章节」用例中追加 `isFree` 断言，避免新增重复 mock。

- [ ] **Step 5：运行单测**

Run:

```bash
cd backend && npm test -- --testPathPattern="create-chapter.dto.spec|update-chapter.dto.spec|chapter.admin.service.spec"
```

Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add backend/src/catalog/dto/create-chapter.dto.ts backend/src/catalog/dto/update-chapter.dto.ts backend/src/catalog/chapter.admin.service.ts backend/src/catalog/dto/create-chapter.dto.spec.ts backend/src/catalog/dto/update-chapter.dto.spec.ts backend/src/catalog/chapter.admin.service.spec.ts
git commit -m "feat(catalog): 管理端章节支持免费试看"
```

---

### 任务 4：免费课程交易与营销限制

**Files:**
- Modify: `backend/src/trade/pricing/pricing.service.ts`
- Modify: `backend/src/trade/order/order.service.ts`
- Modify: `backend/src/promotion/groupon/groupon.admin.service.ts`
- Modify: `backend/src/promotion/flash-sale/flash-sale.admin.service.ts`
- Modify: `backend/src/promotion/coupon/coupon.admin.service.ts`
- Modify: `backend/src/catalog/course.admin.service.ts`
- Modify: `backend/src/trade/pricing/pricing.service.spec.ts`
- Modify: `backend/src/trade/order/order.service.spec.ts`
- Modify: `backend/src/promotion/groupon/groupon.admin.service.spec.ts`
- Modify: `backend/src/promotion/flash-sale/flash-sale.admin.service.spec.ts`
- Modify: `backend/src/promotion/coupon/coupon.admin.service.spec.ts`
- Modify: `backend/src/catalog/course.admin.service.spec.ts`

**Interfaces:**
- Consumes: `Course.saleCents` 既有字段。
- Produces: 免费课程在预览、下单、拼团创建、秒杀创建、券关联、改价六处被拒绝。

- [ ] **Step 1：先补单测（预期失败）**

`pricing.service.spec.ts` 在 `PricingService.preview` describe 中新增：

```ts
  it('免费课程无需购买（422/1001）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ ...PUBLISHED_COURSE, saleCents: 0 });

    await expect(service.preview(1, 1, {})).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
      message: '免费课程无需购买',
    });
  });
```

`order.service.spec.ts` 在「课程下架」用例后新增：

```ts
  it('免费课程不可下单（422/1001）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ ...COURSE, saleCents: 0 });

    await expect(
      service.createOrder(1, { courseId: 1 }, 'key-free-0001'),
    ).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
      message: '免费课程无需购买',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });
```

`groupon.admin.service.spec.ts` 在 `GrouponAdminService.create` describe 中新增：

```ts
  it('免费课程不可创建拼团（422/1001）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({
      id: 1,
      status: 'published',
      saleCents: 0,
    });

    await expect(service.create(CREATE)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
      message: '免费课程不可创建拼团活动',
    });
    expect(prisma.grouponActivity.create).not.toHaveBeenCalled();
  });
```

`flash-sale.admin.service.spec.ts` 在 `FlashSaleAdminService.create` describe 中新增：

```ts
  it('免费课程不可创建秒杀（422/1001）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({
      id: 1,
      status: 'published',
      saleCents: 0,
    });

    await expect(service.create(CREATE)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
      message: '免费课程不可创建秒杀活动',
    });
    expect(prisma.flashSaleActivity.create).not.toHaveBeenCalled();
  });
```

`coupon.admin.service.spec.ts` 在 `CouponAdminService.create` describe 中新增：

```ts
  it('免费课程不可关联优惠券（422/1001）', async () => {
    const { prisma, service } = setup();
    prisma.course.findMany.mockResolvedValue([{ id: 1, saleCents: 0 }]);

    await expect(service.create(CREATE)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
      message: '免费课程不可关联优惠券',
    });
  });
```

`course.admin.service.spec.ts`：

1. `setup()` 的 prisma 增加：

```ts
    couponTemplateCourse: { count: jest.fn().mockResolvedValue(0) },
    grouponActivity: { count: jest.fn().mockResolvedValue(0) },
    flashSaleActivity: { count: jest.fn().mockResolvedValue(0) },
```

2. 在 update describe 末尾新增：

```ts
  it('草稿改价为 0 且无营销关联时允许保存', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(DRAFT);
    prisma.course.updateMany.mockResolvedValue({ count: 1 });
    prisma.course.findUniqueOrThrow.mockResolvedValue({ ...DRAFT, saleCents: 0 });

    await expect(
      service.update(1, { version: 3, originalCents: 19900, saleCents: 0 }),
    ).resolves.toBeDefined();
    expect(prisma.course.updateMany).toHaveBeenCalled();
  });

  it('改价为 0 且存在券关联时拒绝（422）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(DRAFT);
    prisma.couponTemplateCourse.count.mockResolvedValue(1);

    await expect(
      service.update(1, { version: 3, saleCents: 0 }),
    ).rejects.toMatchObject({
      status: 422,
      message: '免费课程不可关联优惠券，请先解除关联',
    });
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
  });

  it('改价为 0 且存在未结束活动时拒绝（422）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue(DRAFT);
    prisma.grouponActivity.count.mockResolvedValue(1);

    await expect(
      service.update(1, { version: 3, saleCents: 0 }),
    ).rejects.toMatchObject({
      status: 422,
      message: '该课程存在未结束的拼团/秒杀活动，请先结束或取消',
    });
    expect(prisma.course.updateMany).not.toHaveBeenCalled();
  });
```

Run:

```bash
cd backend && npm test -- --testPathPattern="pricing.service.spec|order.service.spec|groupon.admin.service.spec|flash-sale.admin.service.spec|coupon.admin.service.spec|course.admin.service.spec"
```

Expected: FAIL（尚无免费课程校验）。

- [ ] **Step 2：实现交易限制**

`pricing.service.ts` 在课程存在性校验之后、活动类型解析之前新增：

```ts
    // 免费课程无需下单：直接拒绝预览
    if (course.saleCents === 0) {
      throw new BizException(ErrorCode.PARAM_INVALID, '免费课程无需购买', 422);
    }
```

`order.service.ts` 在 `createOrderWithQuote` 的课程状态校验之后新增：

```ts
    // 免费课程无需下单：兜底直接调用下单入口
    if (course.saleCents === 0) {
      throw new BizException(ErrorCode.PARAM_INVALID, '免费课程无需购买', 422);
    }
```

- [ ] **Step 3：实现营销限制**

`groupon.admin.service.ts`：课程 select 增加 `saleCents: true`；在「仅已发布课程」校验后新增：

```ts
    // 免费课程退出营销链路
    if (course.saleCents === 0) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '免费课程不可创建拼团活动',
        422,
      );
    }
```

`flash-sale.admin.service.ts`：课程 select 增加 `saleCents: true`；同样位置新增：

```ts
    // 免费课程退出营销链路
    if (course.saleCents === 0) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '免费课程不可创建秒杀活动',
        422,
      );
    }
```

`coupon.admin.service.ts` 的 `assertCoursesPublished`：`findMany` select 增加 `saleCents: true`；在长度校验后新增：

```ts
    // 免费课程不可关联优惠券
    if (published.some((course) => course.saleCents === 0)) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '免费课程不可关联优惠券',
        422,
      );
    }
```

`course.admin.service.ts` 的 `update`：在「售价不得高于原价」校验之后、`pickFields` 之前新增：

```ts
    // 付费课程改价为 0：必须没有券关联与未结束活动
    if (saleCents === 0 && course.saleCents !== 0) {
      const [couponLinks, groupons, flashSales] = await Promise.all([
        this.prisma.couponTemplateCourse.count({ where: { courseId } }),
        this.prisma.grouponActivity.count({
          where: {
            courseId,
            status: { in: ['not_started', 'ongoing'] },
          },
        }),
        this.prisma.flashSaleActivity.count({
          where: {
            courseId,
            status: { in: ['not_started', 'ongoing'] },
          },
        }),
      ]);
      if (couponLinks > 0) {
        throw new BizException(
          ErrorCode.PARAM_INVALID,
          '免费课程不可关联优惠券，请先解除关联',
          422,
        );
      }
      if (groupons + flashSales > 0) {
        throw new BizException(
          ErrorCode.PARAM_INVALID,
          '该课程存在未结束的拼团/秒杀活动，请先结束或取消',
          422,
        );
      }
    }
```

- [ ] **Step 4：运行单测**

Run:

```bash
cd backend && npm test -- --testPathPattern="pricing.service.spec|order.service.spec|groupon.admin.service.spec|flash-sale.admin.service.spec|coupon.admin.service.spec|course.admin.service.spec"
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add backend/src/trade/pricing/pricing.service.ts backend/src/trade/order/order.service.ts backend/src/promotion/groupon/groupon.admin.service.ts backend/src/promotion/flash-sale/flash-sale.admin.service.ts backend/src/promotion/coupon/coupon.admin.service.ts backend/src/catalog/course.admin.service.ts backend/src/trade/pricing/pricing.service.spec.ts backend/src/trade/order/order.service.spec.ts backend/src/promotion/groupon/groupon.admin.service.spec.ts backend/src/promotion/flash-sale/flash-sale.admin.service.spec.ts backend/src/promotion/coupon/coupon.admin.service.spec.ts backend/src/catalog/course.admin.service.spec.ts
git commit -m "feat(trade): 免费课程退出交易与营销链路"
```

---

### 任务 5：种子数据与后端集成测试

**Files:**
- Modify: `backend/prisma/seed-data.ts`
- Modify: `backend/prisma/seed.ts`
- Modify: `backend/test/integration/catalog.spec.ts`
- Modify: `backend/test/integration/learning.spec.ts`
- Modify: `backend/test/integration/trade.spec.ts`
- Modify: `backend/test/integration/admin-catalog.spec.ts`
- Modify: `backend/test/integration/coupon.spec.ts`
- Modify: `backend/test/integration/groupon.spec.ts`
- Modify: `backend/test/integration/flash-sale.spec.ts`

**Interfaces:**
- Consumes: 任务 1-4 的后端行为。
- Produces: 种子课程 1 第一章为试看；集成测试覆盖游客试看、未购试看上报、免费课程交易/营销拒绝、管理端 isFree 回读与改价护栏。

- [ ] **Step 1：更新种子数据**

`backend/prisma/seed-data.ts` 第一章改为：

```ts
    { title: '第一章 类型基础', content: null, isFree: true },
    { title: '第二章 泛型进阶', content: null },
```

`backend/prisma/seed.ts` 的章节 upsert：

```ts
      create: {
        courseId: COURSE_TYPESCRIPT.id,
        title: chapter.title,
        contentType: COURSE_TYPESCRIPT.type,
        content: chapter.content,
        sortOrder,
        isFree: chapter.isFree ?? false,
      },
      update: {
        title: chapter.title,
        contentType: COURSE_TYPESCRIPT.type,
        content: chapter.content,
        isFree: chapter.isFree ?? false,
      },
```

Run:

```bash
cd backend && npx prisma db seed
```

Expected: seed 成功；课程 1 第一章 `is_free = true`。

- [ ] **Step 2：修正 catalog 集成测试**

`backend/test/integration/catalog.spec.ts`：

1. 把「游客访问章节正文 401」替换为：

```ts
  it('游客可读取免费试看章节正文，付费章节仍 401', async () => {
    const free = await request(app.getHttpServer())
      .get(`/api/v1/courses/${COURSE_TYPESCRIPT.id}/chapters/1/content`)
      .expect(200);
    expect(free.body.data.title).toBe(COURSE_TYPESCRIPT.chapters[0].title);
    expect(free.body.data.content).toBeNull();

    await request(app.getHttpServer())
      .get(`/api/v1/courses/${COURSE_TYPESCRIPT.id}/chapters/2/content`)
      .expect(401);
  });
```

2. 「拼团待成团用户不可学习（code=3002）」改用 chapter 2。
3. 「已购用户详情返回章节已学标记」的章节断言增加：

```ts
    expect(before.body.data.chapters[0]).toMatchObject({
      id: 1,
      isFree: true,
    });
    expect(before.body.data.chapters[1]).toMatchObject({
      id: 2,
      isFree: false,
    });
```

- [ ] **Step 3：修正并扩展 learning 集成测试**

`backend/test/integration/learning.spec.ts`：

1. 增加导入：

```ts
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
```

2. 声明 `let prisma: PrismaClient;`，在 `beforeAll` 的 `app.init()` 后赋值，`afterAll` 增加 `await prisma.$disconnect();`。
3. 「未购访问 /learning 403（code=3002）」改用 chapter 2。
4. 文件末尾新增：

```ts
  it('未购登录用户可上报试看章节并进入学习记录', async () => {
    const email = `learning-trial-${Date.now()}@test.com`;
    const user = await prisma.user.create({
      data: {
        email,
        nickname: '试看学员',
        passwordHash: await bcrypt.hash(TEST_PASSWORD, 4),
      },
    });
    try {
      const trial = request.agent(app.getHttpServer());
      await trial
        .post('/api/v1/auth/login')
        .send({ email, password: TEST_PASSWORD })
        .expect(200);

      const visit = await trial
        .post(`/api/v1/learning/${COURSE_TYPESCRIPT.id}/chapters/1/visit`)
        .expect(200);
      expect(visit.body.data).toEqual({
        progressPercent: 50,
        completed: false,
      });

      const records = await trial
        .get('/api/v1/user/study-records')
        .expect(200);
      expect(records.body.data.items[0]).toMatchObject({
        courseId: COURSE_TYPESCRIPT.id,
        visitedCount: 1,
        lastChapterId: 1,
        lastChapterTitle: COURSE_TYPESCRIPT.chapters[0].title,
        progressPercent: 50,
        completed: false,
      });
    } finally {
      await prisma.learningRecord.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
```

- [ ] **Step 4：改写 trade 的 0 元订单用例**

`backend/test/integration/trade.spec.ts` 中「实付 0 元订单仍可支付（确认报名）」整段替换为：

```ts
  it('免费课程不可预览与下单（422/1001）', async () => {
    const freeCourse = await prisma.course.create({
      data: {
        name: `0元课-${SUFFIX}`,
        type: 'audio',
        originalCents: 0,
        saleCents: 0,
        instructor: '测试讲师',
        coverUrl: '',
        status: 'published',
      },
    });
    const agent = await registerAndLogin(`trade-free-${SUFFIX}@test.com`);

    try {
      const preview = await agent
        .get(`/api/v1/checkout/${freeCourse.id}/preview`)
        .expect(422);
      expect(preview.body).toMatchObject({
        code: 1001,
        message: '免费课程无需购买',
      });

      const created = await agent
        .post('/api/v1/orders')
        .set('Idempotency-Key', `itg-trade-free-${SUFFIX}`)
        .send({ courseId: freeCourse.id })
        .expect(422);
      expect(created.body.code).toBe(1001);
      expect(
        await prisma.order.count({ where: { courseId: freeCourse.id } }),
      ).toBe(0);
    } finally {
      await prisma.course.delete({ where: { id: freeCourse.id } });
    }
  });
```

- [ ] **Step 5：扩展 admin-catalog 集成测试**

`backend/test/integration/admin-catalog.spec.ts` 新增用例：

```ts
  it('章节可创建/编辑为免费试看并回读', async () => {
    const agent = await adminAgent();
    const created = await agent
      .post('/api/v1/admin/courses')
      .send({
        name: `试看课-${Date.now()}`,
        type: 'video',
        originalCents: 9900,
        saleCents: 4900,
        instructor: '王老师',
        coverUrl: 'image/2026/11/12/00000000-0000-0000-0000-000000000002.png',
      })
      .expect(201);
    const courseId = created.body.data.id;

    try {
      const chapter = await agent
        .post(`/api/v1/admin/courses/${courseId}/chapters`)
        .send({
          title: '试看章节',
          contentType: 'video',
          content: 'video/2026/11/12/trial.mp4',
          isFree: true,
        })
        .expect(201);
      expect(chapter.body.data.isFree).toBe(true);

      const detail = await agent
        .get(`/api/v1/admin/courses/${courseId}`)
        .expect(200);
      expect(detail.body.data.chapters[0]).toMatchObject({
        id: chapter.body.data.id,
        isFree: true,
      });

      const updated = await agent
        .put(`/api/v1/admin/courses/${courseId}/chapters/${chapter.body.data.id}`)
        .send({ isFree: false })
        .expect(200);
      expect(updated.body.data.isFree).toBe(false);
    } finally {
      await prisma.course.delete({ where: { id: courseId } });
    }
  });

  it('免费课程改价护栏：无关联允许，券关联与未结束活动拒绝', async () => {
    const agent = await adminAgent();
    const base = {
      type: 'video',
      originalCents: 9900,
      saleCents: 4900,
      instructor: '王老师',
      coverUrl: 'image/2026/11/12/00000000-0000-0000-0000-000000000003.png',
    };

    const clean = await agent
      .post('/api/v1/admin/courses')
      .send({ ...base, name: `免费改价-${Date.now()}` })
      .expect(201);
    const couponBlocked = await agent
      .post('/api/v1/admin/courses')
      .send({ ...base, name: `券关联-${Date.now()}` })
      .expect(201);
    const activityBlocked = await agent
      .post('/api/v1/admin/courses')
      .send({ ...base, name: `活动关联-${Date.now()}` })
      .expect(201);

    try {
      await agent
        .put(`/api/v1/admin/courses/${clean.body.data.id}`)
        .send({ version: clean.body.data.version, saleCents: 0 })
        .expect(200);

      const template = await prisma.couponTemplate.create({
        data: {
          name: `改价券-${Date.now()}`,
          discountCents: 1000,
          startAt: new Date(),
          endAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          totalQty: 10,
          status: 'disabled',
        },
      });
      await prisma.couponTemplateCourse.create({
        data: {
          templateId: template.id,
          courseId: couponBlocked.body.data.id,
        },
      });
      const couponRes = await agent
        .put(`/api/v1/admin/courses/${couponBlocked.body.data.id}`)
        .send({ version: couponBlocked.body.data.version, saleCents: 0 })
        .expect(422);
      expect(couponRes.body.message).toBe('免费课程不可关联优惠券，请先解除关联');

      await prisma.grouponActivity.create({
        data: {
          courseId: activityBlocked.body.data.id,
          name: '未结束拼团',
          priceCents: 1000,
          targetSize: 2,
          startAt: new Date(),
          endAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          status: 'not_started',
        },
      });
      const activityRes = await agent
        .put(`/api/v1/admin/courses/${activityBlocked.body.data.id}`)
        .send({ version: activityBlocked.body.data.version, saleCents: 0 })
        .expect(422);
      expect(activityRes.body.message).toBe(
        '该课程存在未结束的拼团/秒杀活动，请先结束或取消',
      );

      await prisma.couponTemplate.delete({ where: { id: template.id } });
    } finally {
      await prisma.course.deleteMany({
        where: {
          id: {
            in: [
              clean.body.data.id,
              couponBlocked.body.data.id,
              activityBlocked.body.data.id,
            ],
          },
        },
      });
    }
  });
```

- [ ] **Step 6：扩展营销集成测试**

三个文件分别新增「免费课程拒绝」用例，公共步骤：

1. 用 Prisma 创建 0 价已发布课程：

```ts
    const freeCourse = await prisma.course.create({
      data: {
        name: `免费营销课-${Date.now()}`,
        type: 'audio',
        originalCents: 0,
        saleCents: 0,
        instructor: '测试讲师',
        coverUrl: '',
        status: 'published',
      },
    });
```

2. 管理员调用对应创建接口，断言 422/1001 与文案：

`coupon.spec.ts`：

```ts
    const res = await admin
      .post('/api/v1/admin/coupons')
      .send({
        name: `免费课券-${Date.now()}`,
        discountCents: 1000,
        startAt: new Date().toISOString(),
        endAt: new Date(Date.now() + 86400000).toISOString(),
        totalQty: 10,
        perUserLimit: 1,
        courseIds: [freeCourse.id],
      })
      .expect(422);
    expect(res.body).toMatchObject({
      code: 1001,
      message: '免费课程不可关联优惠券',
    });
```

`groupon.spec.ts`：

```ts
    const res = await admin
      .post('/api/v1/admin/groupons')
      .send({
        courseId: freeCourse.id,
        name: `免费课团-${Date.now()}`,
        priceCents: 1000,
        targetSize: 2,
        startAt: new Date(Date.now() + 3600000).toISOString(),
        endAt: new Date(Date.now() + 7200000).toISOString(),
      })
      .expect(422);
    expect(res.body).toMatchObject({
      code: 1001,
      message: '免费课程不可创建拼团活动',
    });
```

`flash-sale.spec.ts`：

```ts
    const res = await admin
      .post('/api/v1/admin/flash-sales')
      .send({
        courseId: freeCourse.id,
        name: `免费课秒杀-${Date.now()}`,
        priceCents: 1000,
        stock: 10,
        startAt: new Date(Date.now() + 3600000).toISOString(),
        endAt: new Date(Date.now() + 7200000).toISOString(),
      })
      .expect(422);
    expect(res.body).toMatchObject({
      code: 1001,
      message: '免费课程不可创建秒杀活动',
    });
```

3. 每个用例 finally 中 `await prisma.course.delete({ where: { id: freeCourse.id } });`。

若对应 spec 的 `admin` 变量名不同（如 `adminAgent`），按文件现有命名调整；不得新增重复登录辅助函数。

- [ ] **Step 7：运行新增/修改的集成测试**

Run:

```bash
cd backend && npm run test:all -- --testPathPattern="integration/(catalog|learning|trade|admin-catalog|coupon|groupon|flash-sale)\.spec"
```

Expected: PASS。若本地未启动 PostgreSQL/Redis 或未 seed，先执行 `docker info` 与 `npx prisma db seed`，仍无法运行则在提交说明中记录「集成测试未本地执行，交 CI」。

- [ ] **Step 8：后端全量回归**

Run:

```bash
cd backend && npm test
```

Expected: 通过；允许既有 `comment.service.spec.ts` 5 项失败，但不得出现其他新增失败。

- [ ] **Step 9：提交**

```bash
git add backend/prisma/seed-data.ts backend/prisma/seed.ts backend/test/integration/catalog.spec.ts backend/test/integration/learning.spec.ts backend/test/integration/trade.spec.ts backend/test/integration/admin-catalog.spec.ts backend/test/integration/coupon.spec.ts backend/test/integration/groupon.spec.ts backend/test/integration/flash-sale.spec.ts
git commit -m "test(backend): 覆盖免费章节访问与免费课程限制"
```

---

### 任务 6：前端课程详情章节列表与主按钮

**Files:**
- Modify: `frontend/src/features/catalog/CourseChapterList.tsx`
- Modify: `frontend/src/features/catalog/CourseDetailPage.tsx`
- Create: `frontend/tests/catalog/course-chapter-list.test.tsx`
- Modify: `frontend/tests/catalog/course-detail.test.tsx`

**Interfaces:**
- Consumes: 任务 1 生成的 `ChapterBrief.isFree`。
- Produces: `CourseChapterList` 新 props：

```ts
{
  chapters: ChapterBrief[];
  courseId?: number;
  courseFree?: boolean;
  purchased?: boolean;
  accessReady?: boolean;
  onSelect?: (chapterId: number) => void;
}
```

- [ ] **Step 1：先写组件测试（预期失败）**

新建 `frontend/tests/catalog/course-chapter-list.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { CourseChapterList } from '@/features/catalog/CourseChapterList';

const CHAPTERS = [
  { id: 1, title: '第一章 类型系统', contentType: 'video' as const, sortOrder: 1, isFree: true },
  { id: 2, title: '第二章 泛型', contentType: 'video' as const, sortOrder: 2, isFree: false },
];

describe('CourseChapterList', () => {
  it('只读模式展示试看标记，不展示锁定态', () => {
    render(<CourseChapterList chapters={CHAPTERS} />);

    expect(screen.getByText('试看')).toBeInTheDocument();
    expect(screen.queryByText('购买后学习')).not.toBeInTheDocument();
  });

  it('可交互模式点击章节回调 id，锁定章节展示购买提示', async () => {
    const onSelect = vi.fn();
    render(
      <CourseChapterList
        chapters={CHAPTERS}
        courseId={1}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('购买后学习')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/第二章 泛型/));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('已购用户不展示锁定态', () => {
    render(
      <CourseChapterList
        chapters={CHAPTERS}
        courseId={1}
        purchased
        onSelect={vi.fn()}
      />,
    );

    expect(screen.queryByText('购买后学习')).not.toBeInTheDocument();
  });

  it('免费课程所有章节展示试看且无锁定态', () => {
    render(
      <CourseChapterList
        chapters={CHAPTERS}
        courseId={1}
        courseFree
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getAllByText('试看')).toHaveLength(2);
    expect(screen.queryByText('购买后学习')).not.toBeInTheDocument();
  });

  it('访问判定未就绪时不显示锁定，也不触发跳转', async () => {
    const onSelect = vi.fn();
    render(
      <CourseChapterList
        chapters={CHAPTERS}
        courseId={1}
        accessReady={false}
        onSelect={onSelect}
      />,
    );

    expect(screen.queryByText('购买后学习')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText(/第二章 泛型/));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

Run:

```bash
cd frontend && npm test -- tests/catalog/course-chapter-list.test.tsx
```

Expected: FAIL（组件暂无 props）。

- [ ] **Step 2：实现 CourseChapterList**

完整替换 `frontend/src/features/catalog/CourseChapterList.tsx`：

```tsx
import { LockOutlined } from '@ant-design/icons';
import { List, Tag } from 'antd';
import type { ChapterBrief } from '@/api/types';
import { EmptyState } from '@/components/common/EmptyState';

// 章节目录：展示试看/锁定状态，可交互时点击进入学习页
export function CourseChapterList({
  chapters,
  courseId,
  courseFree = false,
  purchased = false,
  accessReady = true,
  onSelect,
}: {
  // 章节目录（不含正文）
  chapters: ChapterBrief[];
  // 课程 id：可交互模式下用于展示，实际跳转由 onSelect 负责
  courseId?: number;
  // 是否免费课程：全部章节开放
  courseFree?: boolean;
  // 是否已购：已购全部章节开放
  purchased?: boolean;
  // 访问判定是否就绪：登录用户等待订单查询，避免锁定态闪烁
  accessReady?: boolean;
  // 章节点击回调；缺省表示只读（活动详情、管理端预览）
  onSelect?: (chapterId: number) => void;
}) {
  if (chapters.length === 0) {
    return <EmptyState description="课程章节准备中" />;
  }

  // 是否可交互：只读场景不展示锁定态与点击
  const interactive = onSelect !== undefined;

  return (
    <List
      dataSource={chapters}
      renderItem={(chapter, index) => {
        // 是否试看：免费课程或章节标记
        const isTrial = courseFree || chapter.isFree === true;
        // 是否已开放：免费课程/试看章节/已购
        const open = isTrial || purchased;
        // 锁定态：仅可交互且访问判定就绪时展示
        const locked = interactive && accessReady && !open;
        return (
          <List.Item
            style={{ cursor: interactive ? 'pointer' : undefined }}
            onClick={() => {
              if (!interactive || !accessReady || chapter.id === undefined) return;
              onSelect(chapter.id);
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <span>
                {index + 1}. {chapter.title}
              </span>
              <span>
                {isTrial && <Tag color="blue">试看</Tag>}
                {locked && (
                  <Tag icon={<LockOutlined />} color="default">
                    购买后学习
                  </Tag>
                )}
              </span>
            </div>
          </List.Item>
        );
      }}
    />
  );
}
```

`courseId` 在本组件内不参与跳转，但保留给调用方声明语义；若 TypeScript 报未使用参数，解构中保留即可（props 不触发 noUnusedLocals）。如 ESLint 提示未使用，删除该 prop 并将任务 7 的传入一并删除——以 `npm run typecheck` 结果为准。

- [ ] **Step 3：接入详情页**

`frontend/src/features/catalog/CourseDetailPage.tsx`：

1. 主按钮解析函数改为：

```ts
// 详情页主按钮：免费课程或已购用户进入学习，其余购买
function resolveCourseCta(
  courseId: number,
  purchased = false,
  isFree = false,
): { label: string; to: string } {
  if (isFree || purchased) return { label: '立即学习', to: `/learning/${courseId}` };
  return { label: '立即购买', to: `/checkout/${courseId}` };
}
```

2. 把 `isFree` 的计算提前到 `purchased` 之前，并更新 cta：

```ts
  // 是否免费课程：售价为 0
  const isFree = (course.saleCents ?? 0) === 0;
  // 是否已购买：存在该课程的已支付订单
  const purchased = Boolean(
    ordersQuery.data?.items.some(
      (order) => order.courseId === detailId && order.status === 'paid',
    ),
  );
  // 主按钮文案与目标
  const cta = resolveCourseCta(detailId, purchased, isFree);
```

删除后面重复的 `isFree` 声明。

3. 可领券入口条件改为 `coupons.length > 0 && !isFree`。
4. 主按钮统一为：

```tsx
          <div className="course-detail-actions">
            <Button
              type="primary"
              size="large"
              className="course-detail-cta"
              onClick={() => navigate(cta.to)}
            >
              {cta.label}
            </Button>
          </div>
```

5. 章节目录接入：

```tsx
                children: (
                  <CourseChapterList
                    chapters={course.chapters ?? []}
                    courseId={detailId}
                    courseFree={isFree}
                    purchased={purchased}
                    accessReady={!user || Boolean(ordersQuery.isFetched)}
                    onSelect={(chapterId) =>
                      navigate(`/learning/${detailId}?chapterId=${chapterId}`)
                    }
                  />
                ),
```

- [ ] **Step 4：补充详情页测试**

`frontend/tests/catalog/course-detail.test.tsx`：

1. `detail()` 的章节增加 `isFree`：第一章 `true`，第二章 `false`。
2. 新增用例：

```tsx
  it('游客点击免费章节进入学习页并携带章节 id', async () => {
    mockDetail();
    const { router } = renderWithProviders(
      [
        { path: '/courses/:id', element: <CourseDetailPage /> },
        { path: '/learning/:courseId', element: <div>learning-page</div> },
      ],
      '/courses/1',
    );

    await userEvent.click(await screen.findByRole('tab', { name: '章节目录' }));
    expect(await screen.findByText('试看')).toBeInTheDocument();
    expect(screen.getByText('购买后学习')).toBeInTheDocument();

    await userEvent.click(screen.getByText(/第一章 类型系统/));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/learning/1'),
    );
    expect(router.state.location.search).toBe('?chapterId=11');
  });

  it('免费课程展示立即学习且隐藏领券入口', async () => {
    mockDetail({ saleCents: 0 });
    const { router } = renderWithProviders(
      [
        { path: '/courses/:id', element: <CourseDetailPage /> },
        { path: '/learning/:courseId', element: <div>learning-page</div> },
      ],
      '/courses/1',
    );

    const cta = await screen.findByRole('button', { name: '立即学习' });
    expect(screen.queryByRole('button', { name: '领取优惠券' })).not.toBeInTheDocument();
    await userEvent.click(cta);
    await waitFor(() => expect(router.state.location.pathname).toBe('/learning/1'));
  });

  it('登录未购用户章节列表展示锁定态', async () => {
    mockDetail();
    mockFavoriteIds();
    mockOrders([]);
    useSessionStore.getState().setUser({
      id: 2,
      email: 'user@example.com',
      nickname: '学员',
      avatarKey: null,
      avatarUrl: null,
      gender: 'secret',
      role: 'user',
      createdAt: '2026-11-01T00:00:00.000Z',
    } as never);

    renderWithProviders([{ path: '/courses/:id', element: <CourseDetailPage /> }], '/courses/1');

    await userEvent.click(await screen.findByRole('tab', { name: '章节目录' }));
    expect(await screen.findByText('购买后学习')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即购买' })).toBeInTheDocument();
  });
```

- [ ] **Step 5：运行前端测试与类型检查**

Run:

```bash
cd frontend && npm test -- tests/catalog/course-chapter-list.test.tsx tests/catalog/course-detail.test.tsx
cd frontend && npm run typecheck
```

Expected: PASS。

- [ ] **Step 6：提交**

```bash
git add frontend/src/features/catalog/CourseChapterList.tsx frontend/src/features/catalog/CourseDetailPage.tsx frontend/tests/catalog/course-chapter-list.test.tsx frontend/tests/catalog/course-detail.test.tsx
git commit -m "feat(frontend): 课程详情展示试看与锁定章节"
```

---

### 任务 7：学习页公开访问、锁定引导、导航与路由

**Files:**
- Modify: `frontend/src/app/router.tsx`
- Modify: `frontend/src/features/learning/LearningPage.tsx`
- Modify: `frontend/src/features/learning/ChapterNav.tsx`
- Modify: `frontend/tests/msw/handlers.ts`
- Modify: `frontend/tests/learning/learning-page.test.tsx`
- Modify: `frontend/tests/app/router.test.tsx`

**Interfaces:**
- Consumes: 任务 1 的 `ChapterBrief.isFree`；任务 6 的导航跳转约定 `/learning/:id?chapterId=X`。
- Produces:
  - `/learning/:courseId` 公开路由。
  - `resolveInitialChapterId(chapters, requestedChapterId, lastChapterId, isAccessible, ready)`。
  - 学习页游客/未购锁定引导；仅登录用户查询订单与学习记录。

- [ ] **Step 1：公开学习路由**

`frontend/src/app/router.tsx` 第 34 行改为：

```ts
  { path: '/learning/:courseId', layout: 'user', requiresAuth: false, lazy: () => import('@/features/learning/LearningPage') },
```

管理员隔离仍由 `guards.tsx` 的 `user?.role === 'admin' && !path.startsWith('/admin')` 处理，不要改守卫。

- [ ] **Step 2：为 MSW 增加默认订单桩**

`frontend/tests/msw/handlers.ts` 增加：

```ts
  // 我的订单：学习页/详情页登录后判断是否已购，未单独断言的用例统一返回空分页
  http.get(/\/api\/v1\/user\/orders$/, () =>
    HttpResponse.json({
      code: 0,
      message: 'ok',
      data: { items: [], total: 0, page: 1, pageSize: 100 },
      requestId: 'r-my-orders',
    }),
  ),
```

- [ ] **Step 3：先改学习页测试（预期失败）**

`frontend/tests/learning/learning-page.test.tsx`：

1. `courseDetail()` 支持覆盖并给章节加 `isFree`：

```tsx
function courseDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'TypeScript 系统入门',
    type: 'audio',
    coverKey: null,
    coverUrl: null,
    instructor: '张老师',
    originalCents: 19900,
    saleCents: 9900,
    status: 'published',
    intro: '从零掌握类型系统',
    detailRich: null,
    chapters: [
      { id: 11, title: '第一章 类型系统', contentType: 'audio', sortOrder: 1, visited: false, isFree: false },
      { id: 12, title: '第二章 泛型', contentType: 'audio', sortOrder: 2, visited: false, isFree: false },
    ],
    groupon: null,
    flashSale: null,
    claimableCoupons: [],
    ...overrides,
  };
}
```

2. `mockLearning` 改为默认已购、支持未购与章节覆盖，并返回正文请求计数：

```tsx
function mockLearning(options?: {
  contentStatus?: number;
  visit?: { progressPercent: number; completed: boolean };
  purchased?: boolean;
  detail?: Record<string, unknown>;
}) {
  const visits: string[] = [];
  const contentRequests: string[] = [];
  const orders =
    options?.purchased === false
      ? []
      : [
          {
            id: 7,
            orderNo: 'ZX202611100007',
            courseId: 1,
            courseName: 'TypeScript 系统入门',
            activityType: 'normal',
            activityId: null,
            originalCents: 19900,
            currentCents: 9900,
            discountCents: 0,
            paidCents: 9900,
            couponClaimId: null,
            status: 'paid',
            paidAt: '2026-11-10T02:00:00.000Z',
            createdAt: '2026-11-10T01:59:00.000Z',
          },
        ];
  server.use(
    http.get(/\/api\/v1\/courses\/1$/, () =>
      HttpResponse.json(envelope(courseDetail(options?.detail))),
    ),
    http.get(/\/api\/v1\/home\/recommendations$/, () =>
      HttpResponse.json(envelope({ courses: [] })),
    ),
    http.get(/\/api\/v1\/user\/orders$/, () =>
      HttpResponse.json(
        envelope({ items: orders, total: orders.length, page: 1, pageSize: 100 }),
      ),
    ),
    http.get(/\/api\/v1\/user\/study-records$/, () =>
      HttpResponse.json(envelope({ items: [], total: 0, page: 1, pageSize: 20 })),
    ),
    http.get(/\/api\/v1\/courses\/1\/chapters\/(\d+)\/content$/, ({ params }) => {
      contentRequests.push(String(params[0]));
      if (options?.contentStatus === 403) {
        return HttpResponse.json(
          { code: 3002, message: '请先购买课程', data: null, requestId: 'r-403' },
          { status: 403 },
        );
      }
      const id = Number(params[0]);
      return HttpResponse.json(
        envelope({
          id,
          title: id === 11 ? '第一章 类型系统' : '第二章 泛型',
          contentType: 'audio',
          content: `https://cdn.example.com/a${id}.mp3`,
          sortOrder: id === 11 ? 1 : 2,
        }),
      );
    }),
    http.post(/\/api\/v1\/learning\/1\/chapters\/(\d+)\/visit$/, ({ params }) => {
      visits.push(String(params[0]));
      return HttpResponse.json(
        envelope(options?.visit ?? { progressPercent: 50, completed: false }),
      );
    }),
  );
  return { visits, contentRequests };
}
```

3. 把「未购买显示购买后才可学习」改为不依赖 content 403：

```tsx
  it('登录未购显示购买引导且不请求锁定章节正文', async () => {
    const { contentRequests } = mockLearning({ purchased: false });
    const { router } = renderWithProviders(
      [
        { path: '/learning/:courseId', element: <LearningPage /> },
        { path: '/checkout/:courseId', element: <div>checkout-page</div> },
      ],
      '/learning/1',
    );

    expect(await screen.findByText('购买后可学习')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看课程详情' })).toBeInTheDocument();
    expect(contentRequests).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: '去购买' }));
    expect(router.state.location.pathname).toBe('/checkout/1');
  });
```

4. 「未购买空态可返回课程详情」同样改为 `mockLearning({ purchased: false })`，不再使用 `contentStatus: 403`；进入页面后直接等待「购买后可学习」。
5. 新增用例：

```tsx
  it('游客可播放免费试看章节且播放结束不上报', async () => {
    useSessionStore.getState().clear();
    const { visits } = mockLearning({
      purchased: false,
      detail: {
        chapters: [
          { id: 11, title: '第一章 类型系统', contentType: 'audio', sortOrder: 1, isFree: true },
          { id: 12, title: '第二章 泛型', contentType: 'audio', sortOrder: 2, isFree: false },
        ],
      },
    });

    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('正在学习：第一章 类型系统')).toBeInTheDocument();
    finishAudio();
    expect(visits).toEqual([]);
  });

  it('游客点击锁定章节展示登录引导且不请求正文', async () => {
    useSessionStore.getState().clear();
    const { contentRequests } = mockLearning({ purchased: false });
    const { router } = renderWithProviders(
      [
        { path: '/learning/:courseId', element: <LearningPage /> },
        { path: '/courses/:id', element: <div>course-detail</div> },
        { path: '/login', element: <div>login-page</div> },
      ],
      '/learning/1?chapterId=12',
    );

    expect(await screen.findByText('登录后可学习')).toBeInTheDocument();
    expect(contentRequests).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: '去登录' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toContain(
      encodeURIComponent('/learning/1?chapterId=12'),
    );
  });

  it('登录未购可播放试看章节并上报', async () => {
    const { visits } = mockLearning({
      purchased: false,
      detail: {
        chapters: [
          { id: 11, title: '第一章 类型系统', contentType: 'audio', sortOrder: 1, isFree: true },
          { id: 12, title: '第二章 泛型', contentType: 'audio', sortOrder: 2, isFree: false },
        ],
      },
    });

    renderWithProviders(
      [{ path: '/learning/:courseId', element: <LearningPage /> }],
      '/learning/1',
    );

    expect(await screen.findByText('正在学习：第一章 类型系统')).toBeInTheDocument();
    finishAudio();
    await waitFor(() => expect(visits).toEqual(['11']));
  });

  it('登录未购且课程有秒杀时购买引导进入秒杀详情', async () => {
    mockLearning({
      purchased: false,
      detail: {
        flashSale: {
          id: 5,
          courseId: 1,
          courseName: 'TypeScript 系统入门',
          name: '限时秒杀',
          priceCents: 5900,
          stock: 10,
          sold: 0,
          startAt: '2026-11-01T00:00:00.000Z',
          endAt: '2099-12-01T00:00:00.000Z',
          status: 'ongoing',
        },
      },
    });
    const { router } = renderWithProviders(
      [
        { path: '/learning/:courseId', element: <LearningPage /> },
        { path: '/flash-sales/:id', element: <div>flash-sale-detail</div> },
      ],
      '/learning/1',
    );

    expect(await screen.findByText('购买后可学习')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '去购买' }));
    expect(router.state.location.pathname).toBe('/flash-sales/5');
  });
```

6. 现有「正文非 3002 错误时展示接口信息」保留，默认已购即可请求正文。

- [ ] **Step 4：运行学习页测试确认失败**

Run:

```bash
cd frontend && npm test -- tests/learning/learning-page.test.tsx
```

Expected: FAIL（学习页仍要求登录、无锁定引导）。

- [ ] **Step 5：实现 LearningPage**

`frontend/src/features/learning/LearningPage.tsx` 按以下结构修改：

1. 导入增加：

```ts
import { buildLoginRedirect } from '@/app/login-redirect';
import { listMyOrders } from '@/api/trade';
import { useSessionStore } from '@/stores/session';
```

2. `resolveInitialChapterId` 改为：

```ts
// 初始章节：URL 指定优先（即使锁定），其次可访问的最近章节，再次第一个可访问章节，最后第一章
export function resolveInitialChapterId(
  chapters: ChapterBrief[],
  requestedChapterId: number | null,
  lastChapterId: number | null | undefined,
  isAccessible: (chapter: ChapterBrief) => boolean,
  ready = true,
): number | null {
  // 访问判定未就绪时保持空，由页面展示加载态
  if (!ready) return null;
  // URL 指定且属于本课程：锁定也保留，用于展示锁定态
  if (
    requestedChapterId !== null &&
    chapters.some((chapter) => chapter.id === requestedChapterId)
  ) {
    return requestedChapterId;
  }
  // 学习记录的最近章节：仅在可访问时恢复
  if (
    lastChapterId != null &&
    chapters.some(
      (chapter) => chapter.id === lastChapterId && isAccessible(chapter),
    )
  ) {
    return lastChapterId;
  }
  // 第一个可访问章节
  const firstOpen = chapters.find(isAccessible);
  if (firstOpen) return firstOpen.id ?? null;
  // 兜底第一章：无开放章节时展示锁定引导
  return chapters[0]?.id ?? null;
}
```

3. 组件顶部增加用户并调整查询：

```ts
  // 当前会话用户：游客可看免费章节
  const user = useSessionStore((state) => state.user);
  // 学习记录：仅登录用户查询并用于恢复最近章节
  const recordsQuery = useQuery({
    queryKey: queryKeys.studyRecords(1),
    queryFn: () => listStudyRecords(1, 100),
    enabled: validCourseId && Boolean(user),
  });
  // 我的订单：登录后判断当前课程是否已购
  const ordersQuery = useQuery({
    queryKey: queryKeys.myOrdersAll,
    queryFn: () => listMyOrders(1, 100),
    enabled: validCourseId && Boolean(user),
    retry: false,
  });
```

4. 在课程数据就绪后计算：

```ts
  // 是否免费课程
  const courseFree = (courseQuery.data?.saleCents ?? 0) === 0;
  // 是否已购当前课程
  const purchased = Boolean(
    ordersQuery.data?.items.some(
      (order) => order.courseId === courseId && order.status === 'paid',
    ),
  );
  // 章节是否开放：免费课程/试看章节/已购
  function chapterOpen(chapter: ChapterBrief | undefined): boolean {
    if (!chapter) return false;
    return courseFree || chapter.isFree === true || purchased;
  }
  // 学习记录就绪：URL 指定、游客或记录已返回
  const recordsReady =
    requestedChapterId !== null || !user || recordsQuery.isFetched;
  // 订单就绪：游客直接视为就绪，登录用户等订单返回
  const accessReady = !user || ordersQuery.isFetched;
  // 访问判定总就绪
  const viewerReady = recordsReady && accessReady;
  // 当前章节 id
  const activeChapterId = resolveInitialChapterId(
    chapters,
    requestedChapterId,
    lastChapterId,
    chapterOpen,
    viewerReady,
  );
  // 当前章节
  const currentChapter = chapters.find((chapter) => chapter.id === activeChapterId);
  // 购买引导目标：优先进行中的秒杀，其次拼团，最后结算页
  const purchaseTarget = courseQuery.data?.flashSale?.id
    ? `/flash-sales/${courseQuery.data.flashSale.id}`
    : courseQuery.data?.groupon?.id
      ? `/groupons/${courseQuery.data.groupon.id}`
      : `/checkout/${courseId}`;
```

注意：`courseQuery.data` 在定义 `chapterOpen` 时可能为 undefined，函数内部使用外部 `courseFree`/`purchased`，渲染时数据已加载。`lastChapterId` 来自 `currentRecord`，游客时为 undefined。

5. `contentQuery` 的 `enabled` 改为：

```ts
    enabled:
      activeChapterId !== null &&
      viewerReady &&
      validCourseId &&
      chapterOpen(currentChapter),
```

6. 删除文件顶部原来的 `contentQuery.error` 3002 提前 return 块。`handleMediaEnded` 改为：

```ts
  // 播放结束：仅登录且章节开放时上报；游客与锁定章节不上报
  function handleMediaEnded() {
    if (!user || activeChapterId === null || !chapterOpen(currentChapter)) return;
    if (reportedChapterRef.current.has(activeChapterId)) return;
    reportedChapterRef.current.add(activeChapterId);
    reportVisit(activeChapterId);
  }
```

7. 加载条件改为：

```ts
  if (
    courseQuery.isLoading ||
    (validCourseId && !viewerReady && activeChapterId === null)
  ) {
    return <Card loading />;
  }
```

8. 播放区改为分层渲染：

```tsx
      <section className="learning-player-card">
        {activeChapterId !== null && currentChapter && !chapterOpen(currentChapter) ? (
          <EmptyState
            description={user ? '购买后可学习' : '登录后可学习'}
            action={
              <Space>
                {user ? (
                  <Button type="primary" onClick={() => navigate(purchaseTarget)}>
                    去购买
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    onClick={() =>
                      navigate(
                        buildLoginRedirect(
                          `/learning/${courseId}?chapterId=${activeChapterId}`,
                          false,
                        ),
                      )
                    }
                  >
                    去登录
                  </Button>
                )}
                <Button onClick={() => navigate(`/courses/${courseId}`)}>
                  查看课程详情
                </Button>
              </Space>
            }
          />
        ) : contentQuery.isLoading ? (
          <Card loading />
        ) : contentQuery.data ? (
          <>
            {contentQuery.data.contentType === 'video' && (
              <div className="learning-player-head">
                <span className="learning-player-course">{course.name}</span>
                {currentChapter && (
                  <span className="learning-player-chapter">
                    正在学习：{currentChapter.title}
                  </span>
                )}
                {completed && <Tag color="green">已学完</Tag>}
              </div>
            )}
            <ChapterViewer
              content={contentQuery.data}
              courseName={course.name}
              chapterTitle={currentChapter?.title}
              coverUrl={course.coverUrl}
              onEnded={handleMediaEnded}
            />
          </>
        ) : contentQuery.error ? (
          contentQuery.error instanceof ApiError &&
          getErrorAction(contentQuery.error.code) === 'not-purchased' ? (
            <EmptyState
              description={user ? '购买后可学习' : '登录后可学习'}
              action={
                <Space>
                  <Button
                    type="primary"
                    onClick={() =>
                      user
                        ? navigate(purchaseTarget)
                        : navigate(
                            buildLoginRedirect(
                              `/learning/${courseId}?chapterId=${activeChapterId}`,
                              false,
                            ),
                          )
                    }
                  >
                    {user ? '去购买' : '去登录'}
                  </Button>
                  <Button onClick={() => navigate(`/courses/${courseId}`)}>
                    查看课程详情
                  </Button>
                </Space>
              }
            />
          ) : (
            <EmptyState description={contentQuery.error.message} />
          )
        ) : (
          <EmptyState description="暂无章节" />
        )}
      </section>
```

9. `ChapterNav` 增加 props：

```tsx
                      <ChapterNav
                        chapters={chapters}
                        activeChapterId={activeChapterId}
                        visitedChapterIds={visitedChapterIds}
                        courseFree={courseFree}
                        purchased={purchased}
                        onSelect={selectChapter}
                      />
```

- [ ] **Step 6：实现 ChapterNav 锁定标记**

`frontend/src/features/learning/ChapterNav.tsx`：

```tsx
import { LockOutlined } from '@ant-design/icons';
import { List, Tag } from 'antd';
import type { ChapterBrief } from '@/api/types';

// 章节导航：点击切换，展示试看/锁定/已学状态
export function ChapterNav({
  chapters,
  activeChapterId,
  visitedChapterIds,
  courseFree = false,
  purchased = false,
  onSelect,
}: {
  // 章节目录（不含正文）
  chapters: ChapterBrief[];
  // 当前打开的章节 id
  activeChapterId: number | null;
  // 本次会话已上报访问的章节
  visitedChapterIds: Set<number>;
  // 是否免费课程：全部章节开放
  courseFree?: boolean;
  // 是否已购：全部章节开放
  purchased?: boolean;
  // 选择章节回调
  onSelect: (chapterId: number) => void;
}) {
  return (
    <List
      dataSource={chapters}
      renderItem={(chapter, index) => {
        // 后端如返回 visited 则以其为准，否则用本地已访问集合
        const visited =
          chapter.visited === true ||
          (chapter.id !== undefined && visitedChapterIds.has(chapter.id));
        // 是否试看章节
        const isTrial = courseFree || chapter.isFree === true;
        // 是否开放
        const open = isTrial || purchased;
        return (
          <List.Item
            style={{
              cursor: 'pointer',
              paddingInline: 12,
              background: chapter.id === activeChapterId ? '#e6f4ff' : undefined,
            }}
            onClick={() => {
              // OpenAPI 中 id 可选，缺省项不可点击
              if (chapter.id !== undefined) onSelect(chapter.id);
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <span>
                {index + 1}. {chapter.title}
              </span>
              <span>
                {isTrial && <Tag color="blue">试看</Tag>}
                {!open && (
                  <Tag icon={<LockOutlined />} color="default">
                    购买后学习
                  </Tag>
                )}
                {visited && <Tag color="green">已学</Tag>}
              </span>
            </div>
          </List.Item>
        );
      }}
    />
  );
}
```

- [ ] **Step 7：补充路由测试**

`frontend/tests/app/router.test.tsx` 新增：

```tsx
  it('游客可访问学习页，不被重定向到登录', async () => {
    server.use(
      http.get(/\/api\/v1\/courses\/1$/, () =>
        HttpResponse.json({
          code: 0,
          message: 'ok',
          data: {
            id: 1,
            name: 'TypeScript 系统入门',
            type: 'audio',
            saleCents: 9900,
            status: 'published',
            chapters: [
              { id: 1, title: '第一章 类型基础', contentType: 'audio', sortOrder: 1, isFree: true },
            ],
            claimableCoupons: [],
          },
          requestId: 'r-router-learning',
        }),
      ),
      http.get(/\/api\/v1\/home\/recommendations$/, () =>
        HttpResponse.json({
          code: 0,
          message: 'ok',
          data: { courses: [] },
          requestId: 'r-router-rec',
        }),
      ),
      http.get(/\/api\/v1\/courses\/1\/chapters\/1\/content$/, () =>
        HttpResponse.json({
          code: 0,
          message: 'ok',
          data: {
            id: 1,
            title: '第一章 类型基础',
            contentType: 'audio',
            content: 'https://cdn.test/a.mp3',
            sortOrder: 1,
          },
          requestId: 'r-router-content',
        }),
      ),
    );

    renderAt('/learning/1', null);
    expect(
      await screen.findByText('正在学习：第一章 类型基础', undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
  });

  it('管理员访问学习页仍跳管理端工作台', async () => {
    renderAt('/learning/1', { role: 'admin' } as SessionUser);
    expect(
      await screen.findByRole('heading', { name: '工作台' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
```

- [ ] **Step 8：运行前端测试与类型检查**

Run:

```bash
cd frontend && npm test -- tests/learning/learning-page.test.tsx tests/app/router.test.tsx tests/catalog/course-detail.test.tsx tests/catalog/course-chapter-list.test.tsx
cd frontend && npm run typecheck
```

Expected: PASS。若 `LearningPage` 中 `courseQuery.data` 的类型可选导致 `purchaseTarget` 报错，按第 5 步使用可选链并保持 `??` 兜底。

- [ ] **Step 9：提交**

```bash
git add frontend/src/app/router.tsx frontend/src/features/learning/LearningPage.tsx frontend/src/features/learning/ChapterNav.tsx frontend/tests/msw/handlers.ts frontend/tests/learning/learning-page.test.tsx frontend/tests/app/router.test.tsx
git commit -m "feat(frontend): 学习页支持游客试看与锁定引导"
```

---

### 任务 8：管理端章节试看开关与免费课程提示

**Files:**
- Modify: `frontend/src/features/admin/courses/ChapterPanel.tsx`
- Modify: `frontend/src/features/admin/courses/BasicInfoForm.tsx`
- Modify: `frontend/tests/admin/course-workspace.test.tsx`

**Interfaces:**
- Consumes: 任务 1 的 `ChapterCreateInput.isFree`/`ChapterUpdateInput.isFree`、`ChapterBrief.isFree`。
- Produces: 管理端可勾选「免费试看」并在列表展示；售价为 0 时展示提示。

- [ ] **Step 1：先改管理端测试（预期失败）**

`frontend/tests/admin/course-workspace.test.tsx`：

1. `courseDetail()` 章节增加 `isFree: false`。
2. 现有「新增章节携带幂等键」的请求体断言改为：

```ts
    await waitFor(() =>
      expect(chapterBody).toEqual({
        title: '第三章',
        contentType: 'video',
        content: 'video/2026/11/12/new.mp4',
        isFree: false,
      }),
    );
```

3. 现有「编辑章节回填原正文」的请求体断言改为：

```ts
    await waitFor(() =>
      expect(updateBody).toEqual({
        title: '第一章改名',
        content: 'video/2026/11/12/keep.mp4',
        isFree: false,
      }),
    );
```

4. 新增用例：

```tsx
  it('新增章节可勾选免费试看并提交 isFree', async () => {
    let chapterBody: Record<string, unknown> | null = null;
    server.use(
      http.get(detailUrl, () => HttpResponse.json(envelope(courseDetail()))),
      http.post(/\/api\/v1\/admin\/courses\/1\/chapters$/, async ({ request }) => {
        chapterBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          envelope({ id: 3, title: '试看章节', contentType: 'video', sortOrder: 3, isFree: true }),
          { status: 201 },
        );
      }),
      http.post(/\/api\/v1\/admin\/files\/video$/, () =>
        HttpResponse.json(
          envelope({
            key: 'video/2026/11/12/trial.mp4',
            url: 'https://cdn.test/trial.mp4',
            mimeType: 'video/mp4',
            size: 4,
          }),
          { status: 201 },
        ),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');
    await userEvent.click(await screen.findByText('章节维护'));
    await userEvent.click(screen.getByRole('button', { name: '新增章节' }));
    await userEvent.type(screen.getByLabelText('章节标题'), '试看章节');
    await userEvent.click(screen.getByRole('switch', { name: '免费试看' }));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(['video'], 'trial.mp4', { type: 'video/mp4' }));
    await screen.findByRole('button', { name: '更换视频' });
    await userEvent.click(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => expect(chapterBody).toMatchObject({ isFree: true }));
  }, 30_000);

  it('编辑章节回填免费试看开关', async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(
          envelope(
            courseDetail({
              chapters: [
                {
                  id: 1,
                  title: '第一章',
                  contentType: 'video',
                  sortOrder: 1,
                  content: 'video/2026/11/12/keep.mp4',
                  isFree: true,
                },
              ],
            }),
          ),
        ),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');
    await userEvent.click(await screen.findByText('章节维护'));
    expect(await screen.findByText('试看')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: '编辑' })[0]);
    expect(await screen.findByRole('switch', { name: '免费试看' })).toBeChecked();
  }, 30_000);

  it('免费课程展示章节与售价提示', async () => {
    server.use(
      http.get(detailUrl, () =>
        HttpResponse.json(envelope(courseDetail({ saleCents: 0 }))),
      ),
    );

    renderWithProviders(routes, '/admin/courses/1');

    expect(
      await screen.findByText('免费课程：全部章节对所有人开放，试看标记不影响权限'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('免费课程：全部章节公开，不可参与拼团/秒杀/优惠券'),
    ).toBeInTheDocument();
  }, 30_000);
```

Run:

```bash
cd frontend && npm test -- tests/admin/course-workspace.test.tsx
```

Expected: FAIL（无开关、无提示、请求体无 isFree）。

- [ ] **Step 2：实现 ChapterPanel**

`ChapterPanel.tsx`：

1. AntD 导入增加 `Switch`、`Tag`。
2. `ChapterFormValues` 增加 `isFree: boolean;`。
3. `openCreate` 设置 `form.setFieldsValue({ title: '', content: '', isFree: false });`。
4. `openEdit` 回填：

```ts
      isFree: chapter.isFree ?? false,
```

5. `handleSubmit`：

```ts
      if (editing) {
        // 编辑载荷：正文始终提交，未更换时即原 key；isFree 传入即设置
        const input: ChapterUpdateInput = {
          title,
          content,
          isFree: values.isFree,
        };
        await updateMutation.mutateAsync({ chapterId: editing.id ?? 0, input });
        return;
      }
      // 新增载荷：章节类型跟随课程类型
      const input: ChapterCreateInput = {
        title,
        contentType: courseType,
        content,
        isFree: values.isFree,
      };
```

6. 面板顶部提示（放在 `readOnly` Alert 之后）：

```tsx
      {course.saleCents === 0 && (
        <Alert
          type="info"
          showIcon
          message="免费课程：全部章节对所有人开放，试看标记不影响权限"
          style={{ marginBottom: 16 }}
        />
      )}
```

7. 章节卡片标题区增加试看标记：

```tsx
              <Typography.Text strong>
                {chapter.sortOrder}. {chapter.title}
                {chapter.isFree === true && (
                  <Tag color="blue" style={{ marginLeft: 8 }}>
                    试看
                  </Tag>
                )}
              </Typography.Text>
```

8. 弹窗 `Form` 的 `initialValues` 增加 `isFree: editing?.isFree ?? false`，并在正文项后增加：

```tsx
          <Form.Item
            name="isFree"
            label="免费试看"
            valuePropName="checked"
            extra="已发布付费课程的该章节对所有人开放；免费课程下全部章节本就开放"
          >
            <Switch aria-label="免费试看" />
          </Form.Item>
```

- [ ] **Step 3：实现 BasicInfoForm 免费提示**

`BasicInfoForm.tsx`：

1. 表单创建后监听售价：

```ts
  // 当前售价：用于免费课程提示
  const saleCents = Form.useWatch('saleCents', form);
```

2. 售价 `Form.Item` 增加 `extra`：

```tsx
          extra={
            saleCents === 0
              ? '免费课程：全部章节公开，不可参与拼团/秒杀/优惠券'
              : undefined
          }
```

- [ ] **Step 4：运行测试与类型检查**

Run:

```bash
cd frontend && npm test -- tests/admin/course-workspace.test.tsx
cd frontend && npm run typecheck
```

Expected: PASS。

- [ ] **Step 5：提交**

```bash
git add frontend/src/features/admin/courses/ChapterPanel.tsx frontend/src/features/admin/courses/BasicInfoForm.tsx frontend/tests/admin/course-workspace.test.tsx
git commit -m "feat(admin): 章节支持免费试看并提示免费课程"
```

---

### 任务 9：E2E、全量回归与文档校对

**Files:**
- Modify: `frontend/e2e/admin-course.spec.ts`
- Create: `frontend/e2e/free-chapter.spec.ts`

**Interfaces:**
- Consumes: 任务 1-8 的全部实现与种子数据。
- Produces: 游客试看 E2E 与管理端试看开关 E2E；完整回归记录。

- [ ] **Step 1：扩展管理端 E2E**

`frontend/e2e/admin-course.spec.ts` 在新增章节弹窗中：

1. 填写标题后勾选试看：

```ts
  await pageA.getByRole('switch', { name: '免费试看' }).click();
```

2. 保存后断言章节卡出现「试看」：

```ts
  await expect(pageA.getByText('E2E 第一章')).toBeVisible();
  await expect(pageA.getByText('试看')).toBeVisible();
```

3. 打开编辑回填：

```ts
  await pageA.getByRole('button', { name: '编辑' }).first().click();
  await expect(pageA.getByRole('switch', { name: '免费试看' })).toBeChecked();
  await pageA.getByRole('button', { name: '取消' }).click();
```

- [ ] **Step 2：新增游客试看 E2E**

新建 `frontend/e2e/free-chapter.spec.ts`：

```ts
import { expect, test } from '@playwright/test';

test('游客可试看第一章，点击付费章节得到登录引导', async ({ page }) => {
  await page.goto('/courses/1');

  await expect(page.getByRole('button', { name: '立即购买' })).toBeVisible();
  await page.getByRole('tab', { name: '章节目录' }).click();

  // 种子第一章免费试看，第二章锁定
  await expect(page.getByText('试看')).toBeVisible();
  await expect(page.getByText('购买后学习')).toBeVisible();

  await page.getByText(/第一章 类型基础/).click();
  await expect(page).toHaveURL(/\/learning\/1\?chapterId=\d+$/);
  await expect(page.getByText('正在学习：第一章 类型基础')).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);

  // 章节目录点击第二章：展示登录引导且不跳转
  await page.getByRole('tab', { name: '章节目录' }).click();
  await page.getByText(/第二章 泛型进阶/).click();
  await expect(page.getByText('登录后可学习')).toBeVisible();
  await expect(page.getByRole('button', { name: '去登录' })).toBeVisible();
});
```

- [ ] **Step 3：运行 E2E（能启动服务时）**

Run:

```bash
cd frontend && npm run test:e2e -- e2e/free-chapter.spec.ts e2e/admin-course.spec.ts
```

Expected: PASS。若本地无法启动后端/数据库/浏览器，记录「E2E 未本地执行，交 CI」，不得声称已通过。

- [ ] **Step 4：后端全量回归**

Run:

```bash
cd backend && npm test
cd backend && npm run test:all
```

Expected: 单元测试仅允许既有 `comment.service.spec.ts` 5 项失败；集成测试若本地未 seed 则可能出现既有 `catalog.spec.ts` 3 项失败，需先 `npx prisma db seed` 后再跑。任何新增失败必须修复后重跑。

- [ ] **Step 5：前端全量回归**

Run:

```bash
cd frontend && npm run typecheck
cd frontend && npm test
```

Expected: PASS。

- [ ] **Step 6：文档校对**

逐项核对：

1. `项目说明文档.md` 不再出现「所有章节需购买」之类与免费章节冲突的描述；§6.2-§6.7 与 §9 已按任务 1 更新。
2. `backend/接口设计文档.md` 的正文接口权限、章节请求体与免费课程限制与 `openapi.yaml` 一致。
3. `frontend/前端设计框架.md` 第 27 行已无「免费试看」非目标；学习页路由与 3002 行为已更新。
4. `backend/openapi.yaml` 与 `frontend/src/api/schema.d.ts` 一致：执行 `cd frontend && npm run gen:api` 后 `git diff --exit-code -- src/api/schema.d.ts` 无输出。
5. 提交说明与 PR 描述中明确：哪些测试本地实际运行、哪些未运行（例如 E2E 仅 CI）。

- [ ] **Step 7：提交**

```bash
git add frontend/e2e/admin-course.spec.ts frontend/e2e/free-chapter.spec.ts
git commit -m "test(e2e): 覆盖游客试看与章节试看开关"
```

---

## 自检记录

- Spec 覆盖：§5 契约与迁移（任务 1）、§6.1-§6.4 访问核心（任务 2）、§6.7 管理端章节（任务 3）、§6.5-§6.6 交易营销（任务 4）、§6.8 种子与 §11 集成测试（任务 5）、§7.2 详情页（任务 6）、§7.3 学习页与路由（任务 7）、§7.4 管理端 UI（任务 8）、§11 E2E 与 §13 验收（任务 9）。
- 类型一致性：`resolveChapterAccess` 在任务 2 定义、任务 5/6/7 使用；`CourseChapterList` 的 `courseFree/purchased/accessReady/onSelect` 在任务 6 定义、任务 6 详情页使用；`ChapterNav` 的 `courseFree/purchased` 在任务 7 定义并使用；`isFree` 类型来自任务 1 的生成契约。
- 无占位符：所有新增/修改代码、命令、断言与文案均为可执行内容。
