# 必填字段非空与字符串 trim 校验设计

> 日期：2026-11-13 · 状态：待评审 · 适用范围：后端 HTTP 入参校验、前端表单与请求层

## 1. 背景与目标

现有校验只覆盖了部分必填字段：`@IsString()` 能拒绝 `undefined`/`null`，但放行 `''` 与纯空格；部分必填字段（登录密码、昵称、题目解析等）连 `@IsNotEmpty()` 都没有；所有字符串入参都保留首尾空白，导致 `' 张三 '`、`' a@b.com '` 这类值进入数据库或校验失败。

目标：

1. 所有 HTTP 入口的必填字段拒绝 `null`、`undefined`、`''`；字符串字段先 trim 再判断非空。
2. 所有字符串入参（含可选字段、密码、富文本）统一 trim 后入库。
3. 编辑器语义同步：更新接口中“概念上必填”的字符串，传入即不可为空。
4. 前端在提交前统一 trim，并对字符串必填项启用 `whitespace` 规则。
5. OpenAPI 契约同步补齐 `minLength` / `minItems`，前端类型重新生成。

## 2. 非目标

- 服务层内部函数调用（非 HTTP 入参）的校验。
- 请求头 `Idempotency-Key`、媒体签名接口 `key/exp/sig` 的额外校验（各自边界已有校验）。
- 业务规则校验（如价格不得高于原价、活动时间不重叠），保持现状。
- 数据库迁移；已有存量数据的空白不回溯清理。

## 3. 现状与约束

| 项 | 现状 |
| --- | --- |
| 全局管道 | `main.ts` 与 16 个测试各自 `new ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`，无 trim |
| 必填字符串 | 约一半已带 `@IsNotEmpty()`（课程、章节、社区、题目题干、活动名称等） |
| 缺失非空校验 | 登录 `password`；注册 `email`/`password`/`confirmPassword`/`nickname`；改密三字段；资料 `nickname`；题目 `analysis`；题目 `answer[]` 元素 |
| 必填数组 | `CreateExamDto.questionIds`、`ReorderChaptersDto.orderedChapterIds` 允许空数组 |
| 更新接口 | 课程名称/讲师/封面、章节标题已用 `@ValidateIf` 拒绝空值；考试 `title`、题目 `stem`/`analysis`/`answer`、`questionIds` 仍可传空 |
| 前端 | 13 个表单共 49 条 `required` 规则，字符串输入未启用 `whitespace`；请求集中在 `api/client.ts` |
| 测试构造 | 17 处 `new ValidationPipe(...)`（main + 12 集成 + 2 并发 + 2 安全），上传集成测试含 multipart；`smoke.spec.ts` 不注册管道 |

约束：

- 密码 trim 是已确认的决策。含首尾空格的历史密码将无法登录；当前种子与测试数据均不含此情况。
- multipart 请求中文件对象（Buffer/流）不得被遍历或修改。
- 校验失败统一走全局异常过滤器：HTTP 400、`code=1001`。

## 4. 关键决策

| 编号 | 决策 | 结论 |
| --- | --- | --- |
| D1 | 改动范围 | 后端接口层 + 前端表单与请求层；不做服务层内部调用 |
| D2 | trim 落点 | 全局 `TrimmingValidationPipe`，校验前递归 trim `body/query/params` |
| D3 | trim 与存储 | 所有字符串 trim 后校验并入库，含可选字段与密码 |
| D4 | 更新接口语义 | 概念上必填的字符串，传入（非 `undefined`）时拒绝 `null` 与空串 |
| D5 | 可空字段 | `intro`、`detailRich`、`description`、`avatarUrl`、章节 `content` 仍可为空/`null`，但会被 trim |
| D6 | 非字符串必填 | `IsInt`/`IsEnum`/`IsISO8601`/`IsArray` 已能拒绝空值，仅补必填数组的 `ArrayNotEmpty` |
| D7 | 前端 trim | axios 请求拦截器递归 trim JSON `data` 与 `params`（跳过 FormData/Blob/URLSearchParams） |
| D8 | 前端提示 | 字符串必填规则加 `whitespace: true`；数字/选择类规则不动 |
| D9 | 契约同步 | OpenAPI 补 `minLength: 1` / `minItems: 1`，重新生成 `schema.d.ts` |

## 5. 总体方案

### 5.1 后端：TrimmingValidationPipe

新增 `backend/src/common/validation/trimming-validation.pipe.ts`：

- `deepTrimStrings(value)`：
  - `string` → `trim()`；
  - 数组 → 逐项递归；
  - 纯对象（原型为 `Object.prototype` 或 `null`）→ 逐键递归；
  - `Date`、`Buffer`、`Stream`、`FormData`、文件对象及其他类实例 → 原样返回。
- `TrimmingValidationPipe extends ValidationPipe`，重写 `transform(value, metadata)`：先 `deepTrimStrings(value)`，再调用 `super.transform(...)`。
- 行为：`'   '` 在进入 class-validator 前变为 `''`，`@IsNotEmpty()` 触发 400/1001，消息为 `<字段> should not be empty`。

注册点（17 处，选项保持不变，仅替换类名）：

- `src/main.ts`
- 集成测试：`admin-catalog`、`auth`、`catalog`、`community`、`coupon`、`exam`、`flash-sale`、`groupon`、`jobs`、`learning`、`trade`、`upload`（`smoke` 不注册管道，不改）
- 并发测试：`flash-sale-oversell`、`groupon-race`
- 安全测试：`community-xss`、`exam-answer-leak`

### 5.2 后端：DTO 审计清单

补齐 `@IsNotEmpty()`：

| 文件 | 字段 |
| --- | --- |
| `auth/dto/login.dto.ts` | `email`、`password` |
| `auth/dto/register.dto.ts` | `email`、`password`、`confirmPassword`、`nickname` |
| `auth/dto/change-password.dto.ts` | `currentPassword`、`newPassword`、`confirmPassword` |
| `users/dto/update-profile.dto.ts` | `nickname` |
| `exam/dto/create-question.dto.ts` | `analysis` |

补齐 `@IsNotEmpty({ each: true })`：

| 文件 | 字段 |
| --- | --- |
| `exam/dto/create-question.dto.ts` | `answer[]` |

补齐 `@ArrayNotEmpty()`：

| 文件 | 字段 |
| --- | --- |
| `exam/dto/create-exam.dto.ts` | `questionIds` |
| `catalog/dto/reorder-chapters.dto.ts` | `orderedChapterIds` |

更新接口“传入即不可为空”（`@ValidateIf(value !== undefined)` + `@IsString` + `@IsNotEmpty`）：

| 文件 | 字段 |
| --- | --- |
| `exam/dto/update-exam.dto.ts` | `title`；`questionIds` 用 `@ValidateIf` + `@ArrayNotEmpty` |
| `exam/dto/update-question.dto.ts` | `stem`、`analysis`；`answer` 用 `@ValidateIf` + `@ArrayNotEmpty` + `@IsNotEmpty({ each: true })` |

已合规、不重复改动：课程/章节（名称、讲师、封面、标题）、被屏蔽词、帖子、评论、优惠券/秒杀/拼团名称、题目 `key`/`text`/`stem`、嵌套选项 `key`/`text`。

保持可空：`intro`、`detailRich`、`description`、`avatarUrl`、章节 `content`、`submit-attempt.answers`（允许整卷未答提交）。

### 5.3 OpenAPI 契约

补 `minLength: 1`（必填字符串）与 `minItems: 1`（必填数组），并为更新接口的概念必填字段加“传入时不可为空”描述：

- `RegisterRequest`：`email`、`confirmPassword`、`nickname`
- `LoginRequest`：`email`、`password`
- `ChangePasswordRequest`：`currentPassword`、`confirmPassword`
- `ProfileUpdateRequest`：`nickname`
- `QuestionCreateRequest`：`stem`、`analysis`、`answer.items`、`options.items` 的 `key`/`text`
- `QuestionUpdateRequest`：`stem`、`analysis`、`answer`（`minItems: 1`、`items.minLength: 1`）
- `ExamCreateRequest`：`title`、`questionIds`（`minItems: 1`）
- `ExamUpdateRequest`：`title`（minLength）、新增 `questionIds`（`minItems: 1`）
- `ChapterReorderRequest`：`orderedChapterIds`（`minItems: 1`）

回归生成 `frontend/src/api/schema.d.ts`。

### 5.4 前端

- 新增 `frontend/src/api/trim.ts`：`trimDeep()`，规则与后端一致；导出供单测使用。
- `api/client.ts` 请求拦截器：当 `config.data` 或 `config.params` 为纯对象/数组时，替换为 `trimDeep()` 结果；`FormData`、`Blob`、`ArrayBuffer`、`URLSearchParams` 原样传递。
- 13 个表单文件中的字符串必填规则追加 `whitespace: true`：`LoginPage`、`RegisterPage`、`PasswordPage`、`ProfilePage`、`BasicInfoForm`、`CourseCreatePage`、`ChapterPanel`、`ExamForm`、`QuestionForm`、`CouponFormFields`、`FlashSaleFormDrawer`、`GrouponFormDrawer`、`BlockedWordFormModal`。
- 已有显式 `trim()` 的提交逻辑保留（幂等，不再额外重构）。

## 6. 数据流

后端：

```
HTTP 请求 → TrimmingValidationPipe.transform
  → deepTrimStrings(body/query/params)
  → class-transformer 实例化 DTO
  → class-validator 校验（IsNotEmpty 等）
  → Controller → Service → Prisma
```

前端：

```
表单提交 → 业务代码组装 payload
  → axios 请求拦截器 trimDeep(data/params)
  → 后端 Trim 管道（二次兜底）
```

前端 `whitespace` 规则只在输入阶段提示；最终一致由请求层 trim + 后端管道保证。

## 7. 错误处理与边界

| 场景 | 结果 |
| --- | --- |
| 必填字符串为 `''` / 纯空格 / `null` / 缺失 | 400，`code=1001`，`<字段> should not be empty` |
| 必填数组为空数组 | 400，`code=1001` |
| 可选字符串为 `null` | 保持原行为（多数 DTO 允许 `null`） |
| 可选字符串为 `'  x  '` | 存为 `'x'` |
| 密码首尾空格 | trim 后参与正则、`Match` 与入库 |
| multipart 上传 | 文本字段 trim；文件对象不遍历，上传逻辑不变 |
| 媒体签名 `key/exp/sig` | 控制器现有非空与验签逻辑不变 |
| 富文本 | 仅去首尾空白，内部 HTML 不处理 |

## 8. 兼容性与风险

- **密码 trim**：含首尾空格的既有密码无法登录；仓库内种子、测试数据均无此情况，接受该风险。
- **存量数据**：历史记录中的首尾空白不回溯清理，仅保证新写入被 trim。
- **`Match` 装饰器**：密码与确认密码都被 trim 后比较，行为一致。
- **契约与实现同步**：更新接口此前 OpenAPI 未声明 `ExamUpdateRequest.questionIds`，本次补齐，避免“实现支持但契约缺失”。
- **重复校验**：17 处测试管道替换为同一实现，避免生产与测试口径漂移。

## 9. 测试计划

后端：

- 新增 `trimming-validation.pipe.spec.ts`：嵌套对象、数组、`Date`、`null`、`Buffer`/文件对象、非纯对象原样保留；纯空格字符串在 DTO 校验中触发 `IsNotEmpty`。
- DTO 单测补充：登录/注册/改密/资料昵称/题目解析与答案/必填数组/更新接口空值用例。
- 集成 HTTP（新增或扩展）：
  - 登录 `password: '   '` → 400/1001；
  - 注册 `nickname: '   '` → 400/1001；
  - 更新资料 `nickname: ''` → 400/1001；
  - 创建考试 `title: '   '`、`questionIds: []` → 400/1001；
  - 创建题目 `analysis: '   '`、`answer: ['']` → 400/1001；
  - 章节重排 `orderedChapterIds: []` → 400/1001；
  - 正常请求中字符串首尾空白被去除（响应/落库断言）。
- 回归：后端全量单测；12 个集成 + 2 并发 + 2 安全测试；`upload.spec.ts` 验证 multipart 不受影响；`tsc --noEmit`。

前端：

- `trimDeep()` 单测（对象、数组、Date、FormData、嵌套）。
- 受影响表单测试更新（如断言提交载荷被 trim）。
- `npm run typecheck`；相关 vitest 用例。

## 10. 实施顺序

1. 新增 Trim 管道与单测；替换 17 处注册点。
2. DTO 审计与单测（TDD：先补失败用例）。
3. OpenAPI 契约更新并重新生成 `schema.d.ts`。
4. 前端 `trimDeep` + 请求拦截器 + 表单 `whitespace` 规则。
5. 集成 HTTP 用例与全量回归；本地 e4f49c 构建重启后做线上验证。

## 11. 验收标准

- 所有 HTTP 必填入参对 `null`、`undefined`、`''`、纯空格返回 400/1001。
- 所有字符串入参入库值无首尾空白（密码按 trim 后值参与认证）。
- 必填数组为空数组返回 400/1001。
- multipart 上传、媒体签名读取、富文本展示行为不回退。
- 后端全量单测与全部集成/并发/安全测试通过；前端 typecheck 与相关测试通过。
- OpenAPI 与实现一致，`schema.d.ts` 重新生成无类型破坏。
