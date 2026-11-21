# 课程免费章节与免费课程设计

> 日期：2026-11-20 · 状态：已确认 · 适用范围：课程/学习/交易/营销后端、课程详情与学习页前端、OpenAPI 契约与产品文档

## 1. 背景与目标

当前课程正文只对「已登录且已支付」的用户开放：`CourseService.getChapterContent` 先校验 `hasPaidAccess`，未购返回 3002；学习页路由 `requiresAuth: true`，章节列表在详情页只是纯文本，无法试看。课程售价允许为 0 且前端展示「免费」，但访问仍被购买门槛拦截，语义不一致。

目标：

1. 章节支持「免费试看」标记：免费章节对所有访客（含未登录）开放。
2. 付费章节要求登录且已购买（含拼团成功）；未登录返回 401 引导登录，登录未购返回 3002 引导购买。
3. 课程售价为 0 即免费课程：全部章节对所有人开放，无需下单。
4. 登录用户观看免费章节/免费课程可记录学习进度与学习记录（已确认）；游客不记录。
5. 免费课程退出交易与营销链路：不可下单、不可创建拼团/秒杀、不可关联优惠券。
6. 管理端可逐章设置试看；OpenAPI、产品文档、接口文档同步。

## 2. 非目标

- 不做「试看时长/试看百分比」限制，试看粒度为整章。
- 不做已购课程改为免费后的退款、订单补偿或权益回收。
- 不清理免费课程的历史营销数据；仅新增校验与改价护栏。
- 活动详情页（拼团/秒杀）的章节列表保持只读，仅展示试看与锁定标记，不承载跳转（避免与活动购买路径冲突）。
- 管理端角色仍不能进入用户端学习页（现有角色隔离不变）。

## 3. 现状与约束

| 项 | 现状 |
| --- | --- |
| 正文接口 | `GET /courses/{courseId}/chapters/{cid}/content` 非公开，需登录；`getChapterContent` 先查 `hasPaidAccess`，未购 3002/403 |
| 访问上报 | `POST /learning/{courseId}/chapters/{cid}/visit` 需登录，`recordVisit` 先查 `hasPaidAccess` |
| 课程详情 | `@Public`；章节目录仅名称/类型/序号；`visited` 仅已购用户返回 |
| 前端路由 | `/learning/:courseId` 为 `requiresAuth: true, roles: ['user']` |
| 前端章节列表 | `CourseChapterList` 纯展示，不区分试看/锁定；学习页 `ChapterNav` 只标「已学」 |
| 免费展示 | 售价 0 仅展示「免费」，无免费语义 |
| 错误动作 | 2001 全局清会话跳登录；2002 跳 `/403`；3002 映射 `not-purchased`（页面内处理，不整页跳转） |
| 契约流程 | 先改设计文档与 `backend/openapi.yaml`，再后端实现，再 `npm run gen:api`，CI 校验生成类型无差异 |
| 测试现状 | `course.service.spec.ts` 直接 mock `hasPaidAccess`；`learning.service.spec.ts` 注入 `{ hasPaidAccess }`；集成测试覆盖 catalog/learning/admin-catalog/coupon/groupon/flash-sale |

约束：

- 免费课程 = `saleCents === 0`（已确认，不新增课程字段）。
- 登录用户观看免费章节也计入进度，分母为全部章节（已确认）。
- 免费课程禁止拼团、秒杀、优惠券（已确认）。
- 游客不记录学习进度（无账号），前端不得对游客调用上报接口。
- 全局 401 会整页跳登录，前端对「已知锁定」的章节不得发起正文请求，避免试看页被强制跳走。
- 非测试代码每个函数、变量需中文注释；测试文件不加注释。

## 4. 关键决策

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| D1 | 免费课程识别 | `saleCents === 0`，不新增课程字段；课程响应不新增 `isFree` 冗余字段，前端由售价派生 |
| D2 | 免费章节存储 | `Chapter.isFree Boolean @default(false)`，逐章控制 |
| D3 | 游客可看范围 | 已发布免费课程的任意章节；已发布付费课程的免费章节 |
| D4 | 付费章节错误语义 | 游客 401/2001；登录未购 3002/403（保持现状） |
| D5 | 访问判定位置 | 集中在 `CourseService.resolveChapterAccess`，正文与学习上报共用 |
| D6 | 学习记录 | 登录用户通过访问判定即可上报；付费课程试看也会进入学习记录，进度分母为全部章节；登录用户进入免费课程即生成 0% 学习记录（课程访问表，不计章节进度） |
| D7 | 课程详情 visited | 对所有登录用户返回（有记录才显示） |
| D8 | 交易限制 | 免费课程结算预览/下单 1001/422「免费课程无需购买」 |
| D9 | 营销限制 | 免费课程禁止拼团/秒杀/优惠券；售价改为 0 时若存在券关联或未结束活动则拒绝保存 |
| D10 | 前端锁定策略 | 锁定章节不发正文请求，页面内展示登录/购买引导；游客点击锁定章节进入学习页内联引导 |
| D11 | 管理端试看 | 章节创建/编辑支持 `isFree`，列表展示「试看」标记；免费课程在基本信息与章节页给出提示 |
| D12 | 种子数据 | TypeScript 演示课第一章设为免费试看，支撑本地演示与 E2E |

## 5. 数据模型与契约

### 5.1 Prisma 与迁移

`backend/prisma/schema.prisma`：

```prisma
model Chapter {
  // ...既有字段
  isFree      Boolean    @default(false) // 免费试看：已发布付费课程的该章节对所有人开放
}
```

新增迁移 `backend/prisma/migrations/<timestamp>_add_chapter_is_free/migration.sql`：`ALTER TABLE "chapters" ADD COLUMN "is_free" BOOLEAN NOT NULL DEFAULT false;`（由 `prisma migrate dev` 生成，名称以实际时间戳为准）。

`Course` 不加字段；免费课程由 `saleCents === 0` 派生。

### 5.2 OpenAPI（backend/openapi.yaml）

| 位置 | 变更 |
| --- | --- |
| `ChapterBrief` | 新增 `isFree: { type: boolean, description: 免费试看章节；免费课程下所有章节均可看 }` |
| `ChapterContent` | 描述改为：免费章节与免费课程公开；付费章节需登录且已购买 |
| `GET /courses/{courseId}/chapters/{cid}/content` | `security: []`；summary/description 更新为免费章节公开、付费章节 401/403；保留 401 与 403 响应，补 404（课程/章节不存在） |
| `ChapterCreateRequest` | 新增可选 `isFree`（boolean，默认 false） |
| `ChapterUpdateRequest` | 新增可选 `isFree`（boolean，传入即设置） |
| `CourseBrief.saleCents` | 描述补充：售价为 0 即免费课程，全部章节公开且不可下单/参与营销 |
| 管理端拼团/秒杀/优惠券创建接口 | 描述补充：免费课程不可关联 |

### 5.3 文档同步

- `项目说明文档.md`
  - §6.2 课程浏览与详情：拆分「查看章节正文内容」为免费章节/免费课程与付费章节；主按钮规则增加免费课程。
  - §6.3 课程管理：章节维护增加「免费试看」；售价 0 的课程提示与营销限制；改价护栏。
  - §6.4 课程学习：游客可进入学习页观看免费内容；未购登录用户可看试看章节并记录进度；免费课程无需购买。
  - §6.5/§6.6/§6.7（券/拼团/秒杀）：免费课程不可关联/创建。
  - §9 演示数据：TypeScript 课程第一章为免费试看。
- `backend/接口设计文档.md`：同步章节字段、正文接口权限、管理端章节请求体、免费课程限制。
- `frontend/前端设计框架.md`：课程详情章节列表（试看/锁定）、学习页游客态与锁定态、免费课程主按钮。

## 6. 后端设计

### 6.1 统一访问判定

`backend/src/catalog/course.service.ts` 新增类型与方法：

```ts
// 章节访问结果：命中的章节行与访问来源
export interface ChapterAccessResult {
  chapter: Chapter; // 命中的章节
  access: 'free' | 'paid'; // free=免费开放；paid=已购开放
}

// 解析章节访问权限：未授权抛出 404/401/3002
async resolveChapterAccess(
  userId: number | null,
  courseId: number,
  chapterId: number,
): Promise<ChapterAccessResult>
```

判定顺序（保持「未购不泄露付费章节是否存在」）：

1. 并行读取课程与章节（`chapter.findFirst({ id, courseId })`）；课程不存在 → 3001/404「课程不存在」。
2. `paid = userId !== null && hasPaidAccess(userId, courseId)`；已购：章节不存在 → 3001/404「章节不存在」，否则返回 `{ chapter, access: 'paid' }`（下架课程已购用户仍可访问，保持现状）。
3. 免费开放条件：`course.status === 'published' && (course.saleCents === 0 || chapter?.isFree === true)`；满足时章节不存在 → 3001/404，否则返回 `{ chapter, access: 'free' }`。
4. 未满足：`userId === null` → 2001/401「请先登录」；否则 → 3002/403「请先购买课程」。

`hasPaidAccess` 保持不变（仍用于已购判定与课程详情）。

### 6.2 章节正文接口

`backend/src/catalog/course.controller.ts`：

- 内容路由增加 `@Public()`，`@CurrentUser()` 允许为 null，调用 `getChapterContent(user?.userId ?? null, ...)`。
- `CourseService.getChapterContent(userId: number | null, courseId, chapterId)` 改为调用 `resolveChapterAccess`，用返回的 `chapter` 生成 `ChapterContent`；媒体 key 签名逻辑不变。

### 6.3 访问上报

`backend/src/learning/learning.service.ts`：

- `recordVisit` 用 `resolveChapterAccess(userId, courseId, chapterId)` 替代 `hasPaidAccess` + 单独章节查询；未通过时由该方法抛出 401/3002。
- 进度与「是否学完」逻辑不变：分母为课程全部章节。
- 学习记录分页保持「已购 ∪ 有记录」；试看记录自然进入列表，无需过滤未购课程。
- 新增课程访问上报 `recordCourseVisit`（`POST /learning/{courseId}/visit`）：登录用户进入免费课程学习页时上报，写入 `course_visits`（userId+courseId 复合主键，重复进入仅刷新 visitedAt）；仅已发布的免费课程（`saleCents === 0`）或已购课程允许，否则 3002/403。
- 课程访问只让课程以 0% 进度进入学习记录，不写 `learning_records`、不计章节进度；`getStudyRecords` 的来源扩展为「已购 ∪ 章节访问 ∪ 课程访问」。

### 6.4 课程详情

`CourseService.getDetail`：

- `canSeeVisited` 改为 `userId !== undefined`（不再要求已购）；已学记录查询条件不变。
- 章节查询字段 `CHAPTER_BRIEF_SELECT` 增加 `isFree`，`ChapterBrief` 接口增加 `isFree`。
- `claimableCoupons`：`course.saleCents === 0` 时返回空数组（免费课程不展示可领券）。

### 6.5 交易限制

- `backend/src/trade/pricing/pricing.service.ts` `preview`：课程存在性校验后增加 `course.saleCents === 0` → `BizException(1001, '免费课程无需购买', 422)`。
- `backend/src/trade/order/order.service.ts` `createOrderWithQuote`：课程状态校验后同样拒绝免费课程（兜底直接调用）。
- 前端详情页不再为免费课程提供购买入口；直接访问 `/checkout/:courseId` 时展示接口错误信息（现有 inline 错误处理）。

### 6.6 营销限制

| 文件 | 变更 |
| --- | --- |
| `backend/src/promotion/groupon/groupon.admin.service.ts` `create` | 课程查询增加 `saleCents`；`saleCents === 0` → 1001/422「免费课程不可创建拼团活动」 |
| `backend/src/promotion/flash-sale/flash-sale.admin.service.ts` `create` | 同上，文案「免费课程不可创建秒杀活动」 |
| `backend/src/promotion/coupon/coupon.admin.service.ts` `assertCoursesPublished` | 查询增加 `saleCents`；任一为 0 → 1001/422「免费课程不可关联优惠券」 |
| `backend/src/catalog/course.admin.service.ts` `update` | 最终 `saleCents === 0` 且原售价非 0 时：存在券模板关联（`couponTemplateCourse.count`）→ 422「免费课程不可关联优惠券，请先解除关联」；存在 `not_started`/`ongoing` 的拼团或秒杀 → 422「该课程存在未结束的拼团/秒杀活动，请先结束或取消」 |

### 6.7 管理端章节

- `create-chapter.dto.ts` / `update-chapter.dto.ts`：新增 `@IsOptional() @IsBoolean() isFree?: boolean`。
- `chapter.admin.service.ts`：创建落库 `isFree: dto.isFree ?? false`；更新按 `dto.isFree === undefined ? {} : { isFree: dto.isFree }`；`listChapters` select 增加 `isFree`，`ChapterBriefRow` 增加字段。
- 审计快照自动包含新字段。

### 6.8 种子数据

- `backend/prisma/seed-data.ts`：`COURSE_TYPESCRIPT.chapters` 第一章增加 `isFree: true`。
- `backend/prisma/seed.ts`：章节 upsert 的 create/update 写入 `isFree: chapter.isFree ?? false`。
- 课程 1 为已发布付费课并带进行中拼团，不影响「活动课程不进入普通列表」的既有规则。

## 7. 前端设计

### 7.1 契约与类型

- 更新 openapi 后执行 `npm run gen:api`；`ChapterBrief`/`ChapterCreateInput`/`ChapterUpdateInput` 自动获得 `isFree`。
- 不手写重复类型；`api/types.ts` 无需新增别名。

### 7.2 课程详情页（CourseDetailPage / CourseChapterList）

- `isFree = (course.saleCents ?? 0) === 0`（现有派生保留）。
- 主按钮：`isFree || purchased` → 「立即学习」；否则「立即购买」。免费课程游客点击直接进入学习页。
- `CourseChapterList` 增加访问展示与点击能力：
  - 每项显示序号与标题；`chapter.isFree` 或课程免费时展示「试看」Tag；锁定项展示锁形图标/Tag「购买后学习」。
  - 可访问（课程免费 / 章节免费 / 已购）与锁定项均可点击，统一跳转 `/learning/{courseId}?chapterId={id}`，由学习页承载登录/购买引导。
  - 组件增加可选回调与访问判定入参；未传回调的场景（管理端预览、活动详情页）保持只读，仅展示「试看」标记。
- 活动详情页与管理端预览复用同一组件，只读且不显示锁定态（无法获知活动购买状态）。

### 7.3 学习页（LearningPage / ChapterNav）

- 路由 `/learning/:courseId` 改为 `requiresAuth: false`，移除 `roles` 限制（管理端仍被角色隔离规则重定向到 `/admin`）。
- 数据：
  - 课程详情公开查询不变。
  - 学习记录查询仅在 `user` 存在时启用；章节就绪条件调整为 `requestedChapterId !== null || !user || recordsQuery.isFetched`，避免游客因记录查询被禁用而永久等待。
  - 新增「我的订单」查询（登录时启用，复用 `queryKeys.myOrdersAll`），用于判定 `purchased`。
- 访问判定（前端展示用，服务端仍是权威）：
  - `courseFree = saleCents === 0`
  - `chapterOpen(chapter) = courseFree || chapter.isFree === true || purchased`
- 初始章节：URL 指定优先（即使锁定也保留，用于展示锁定态）；其次学习记录最近章节（仅可访问时）；再次第一个可访问章节；最后第一章。
- 正文查询：仅当当前章节可访问时启用；锁定章节不发请求，避免 401 全局跳转与无意义的 3002。
- 锁定态播放区：
  - 游客：「登录后可学习」+「去登录」（`buildLoginRedirect(当前路径含 chapterId, false)`）+「查看课程详情」。
  - 登录未购：「购买后可学习」+「去购买」（课程存在进行中秒杀 → `/flash-sales/{id}`；进行中拼团 → `/groupons/{id}`；否则 `/checkout/{courseId}`）+「查看课程详情」。
- `ChapterNav`：新增锁定标记（锁形图标/Tag），已学标记保留；`visitedChapterIds` 仅登录用户。
- 播放完成上报：仅 `user && chapterOpen(activeChapter)` 时调用；游客与锁定章节不调用。
- 进入免费课程上报：登录用户进入免费课程学习页（`user && courseFree`）时调用一次 `POST /learning/{courseId}/visit`，生成 0% 学习记录并刷新学习记录缓存；游客与付费课程不调用（付费课程由订单自然进入学习记录）。
- 学习记录/进度：直接使用服务端返回的 `progressPercent`/`completed`（试看用户分母为全部章节）。

### 7.4 管理端课程

- `ChapterPanel`：
  - `ChapterFormValues` 增加 `isFree: boolean`；新增/编辑弹窗增加「免费试看」Switch（附说明：已发布付费课程的该章节对所有人开放）。
  - 新增时默认关闭；编辑回填 `chapter.isFree`；创建/更新载荷携带 `isFree`。
  - 章节卡片展示「试看」Tag；课程售价为 0 时在面板顶部提示「免费课程：全部章节对所有人开放，试看标记不影响权限」。
- `BasicInfoForm`：监听取值 `saleCents`，为 0 时在售价项下展示提示「免费课程：全部章节公开，不可参与拼团/秒杀/优惠券」。
- 营销管理端（拼团/秒杀/优惠券）：不做课程下拉过滤，提交后由后端 422 文案提示（沿用现有 `message.error`）。

## 8. 数据流

游客访问免费章节：

```
详情页章节点击 → /learning/:id?chapterId=X（公开路由）
  → 课程详情（公开）+ 章节 isFree/价格派生判定
  → 可访问：GET content（公开，服务端 resolveChapterAccess）
  → 播放结束：游客不上报
```

登录未购用户观看试看章节：

```
GET content → 200（free）
播放结束 → POST visit → resolveChapterAccess（free）→ 写入 learningRecord
→ 学习记录列表出现该课程与试看进度
```

登录用户进入免费课程：

```
进入 /learning/:id（免费课程，user 存在）→ POST /learning/:id/visit（每次进入一次）
→ course_visits 写入/刷新 → 学习记录出现该课程：0%、最近章节为空
播放结束 → POST /learning/:id/chapters/:cid/visit → 写入 learningRecord，追加章节进度
```

付费章节：

```
游客：前端判定锁定，不发 content 请求 → 内联「登录后可学习」
登录未购：前端判定锁定，不发 content 请求 → 内联「购买后可学习」
已购：GET content → resolveChapterAccess（paid）→ 正常播放与上报
```

## 9. 错误处理与边界

| 场景 | 结果 |
| --- | --- |
| 游客看已发布免费课程任意章节 | 200；不记录进度 |
| 游客看付费课程免费章节 | 200；不记录进度 |
| 游客/未购用户请求付费章节正文（直接调接口） | 401/2001 或 3002/403，不泄露章节是否存在 |
| 免费课程未发布 | 未购用户按未授权处理（游客 401、登录 3002）；课程详情本身 404，用户端不可见 |
| 付费课程下架 | 游客/未购 401/3002；已购仍可看（保持现状） |
| 免费课程结算预览/下单 | 1001/422「免费课程无需购买」 |
| 免费课程创建拼团/秒杀/关联券 | 1001/422，文案见 §6.6 |
| 付费课程改价为 0 且存在券/未结束活动 | 422，提示先解除关联 |
| 试看用户学习记录 | 出现在学习记录，进度分母为全部章节；已学完需看完全部章节 |
| 登录用户进入免费课程 | 生成 0% 学习记录（不写章节记录）；重复进入仅刷新时间；播放章节后追加进度 |
| 游客/未购用户调用课程访问上报 | 游客 401；付费未购课程 3002/403 |
| 管理员访问 `/learning/:id` | 仍按角色隔离重定向 `/admin` |

## 10. 兼容性与风险

- **既有 0 元课程**：上线后立即变成全开放且不可下单；seed 无 0 元课程，发布前核对本地/线上数据。
- **公开正文接口**：必须避免为锁定章节发起请求，否则全局 401 整页跳转会破坏试看体验；前端以访问判定作为发请求门槛。
- **接口语义变化**：`getChapterContent` 参数由 `userId: number` 变为 `number | null`，现有单测需改为 mock Prisma 课程/章节并覆盖矩阵。
- **学习记录语义扩展**：未购用户的试看课程会出现在学习记录；按已确认决策接受。
- **课程详情 visited 扩大**：任一登录用户可看到自己的已学标记，不影响未登录访客。
- **种子改动**：课程 1 第一章变为试看，集成测试若断言章节字段需补 `isFree`；购买 E2E 流程不受影响。
- **活动页限制**：活动详情页章节列表只读，试看入口需通过课程详情或直接 URL 进入，作为本期已知边界。

## 11. 测试计划

后端单测：

- `course.service.spec.ts`：访问矩阵（免费课程×游客/登录/已购、付费课程免费章节×三种身份、付费章节×三种身份、未发布课程、章节不存在、下架课程已购）；`getDetail` 的 `visited` 对所有登录用户返回、免费课程 `claimableCoupons` 为空。
- `learning.service.spec.ts`：试看可上报、锁定时 401/3002、游客不可调用（控制器守卫）、进度分母不变；课程访问上报（免费课程 0%、已购可上报、未购 3002、课程不存在 3001、不写章节记录）；学习记录聚合（课程访问 0% 条目、与章节访问取较晚时间）。
- `pricing.service.spec.ts` / `order.service.spec.ts`：免费课程预览与下单 422/1001。
- `groupon.admin.service.spec.ts` / `flash-sale.admin.service.spec.ts` / `coupon.admin.service.spec.ts`：免费课程拒绝。
- `course.admin.service.spec.ts`：改价为 0 的护栏（券关联、未结束活动）。
- `create-chapter.dto.spec.ts` / `update-chapter.dto.spec.ts`：`isFree` 类型校验与透传。

后端集成（`backend/test/integration`）：

- `catalog.spec.ts`：游客看免费章节 200、看付费章节 401；登录未购 200/3002；已购 200；章节 `isFree` 字段返回。
- `learning.spec.ts`：试看上报成功并进入学习记录；锁定章节上报 3002；登录用户进入免费课程生成幂等 0% 学习记录；付费未购课程访问上报 3002。
- `admin-catalog.spec.ts`：章节创建/更新带 `isFree`；免费课程改价护栏。
- `coupon.spec.ts` / `groupon.spec.ts` / `flash-sale.spec.ts`：免费课程拒绝用例。
- `trade.spec.ts`：免费课程预览与下单 422。

前端：

- `CourseChapterList` 组件测试：试看 Tag、锁定标记、点击回调。
- `LearningPage`（msw）：游客免费章节渲染播放器且不请求上报；游客锁定章节展示登录引导且不请求正文；登录未购展示购买引导；已购正常；登录用户进入免费课程上报一次课程访问，游客与付费课程不上报。
- 路由测试：`/learning/:id` 对游客放行，管理员仍重定向。
- `ChapterPanel` / `BasicInfoForm`：isFree 开关回填与提交、免费提示。
- `npm run typecheck`、相关 vitest。

E2E（Playwright）：

- 游客打开 `/courses/1` → 章节列表第一章标「试看」、第二章锁定 → 点击第一章进入学习页并展示章节标题，无登录跳转 → 点击第二章展示登录引导。
- 管理员创建课程时勾选试看章节并保存，重新打开编辑回填一致（扩展 `admin-course.spec.ts`）。

## 12. 实施顺序

1. 契约与文档：openapi、产品/接口/前端设计文档；Prisma schema 与迁移；`prisma generate`。
2. 后端访问核心：`resolveChapterAccess`、正文公开路由、学习上报复用；更新单测。
3. 后端约束：免费课程交易/营销/改价护栏；管理端章节 `isFree`；单测。
4. 种子与集成测试：seed 试看章节、集成用例、全量后端回归。
5. 前端：`gen:api`、详情章节列表、学习页与路由、组件测试。
6. 管理端 UI 与测试。
7. E2E、全量回归、文档校对。

## 13. 验收标准

- 游客可直接观看已发布免费课程的任意章节与付费课程的免费章节（无需登录）。
- 付费章节：游客得到登录引导；登录未购得到购买引导；已购（含拼团成团）可正常学习。
- 免费课程全章节开放，详情页直接「立即学习」，无购买/优惠券入口，接口拒绝下单、拼团、秒杀、券关联。
- 登录用户观看免费章节/免费课程可记录进度并出现在学习记录；进入免费课程即生成 0% 学习记录（无需播放）；游客不产生记录。
- 管理端可逐章设置/取消试看，免费课程有明确提示；改价护栏生效。
- OpenAPI 与实现一致，生成类型无差异；后端单测/集成测试、前端 typecheck/测试、E2E 通过；文档与种子数据同步。
