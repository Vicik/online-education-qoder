# 必填字段非空与字符串 trim 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有 HTTP 必填入参拒绝 `null`/`undefined`/`''`/纯空格，所有字符串入参在入库前统一 trim；前端表单与请求层同步。

**Architecture:** 后端新增 `TrimmingValidationPipe extends ValidationPipe`，校验前递归 trim `body/query/params`，替换 `main.ts` 与 16 个测试中的 17 处注册；再按审计清单给 DTO 补 `@IsNotEmpty`、`@ArrayNotEmpty`、`@ValidateIf`。OpenAPI 补 `minLength`/`minItems` 后重新生成前端类型。前端新增 `trimDeep()` 并在 axios 请求拦截器中应用，表单字符串必填规则补 `whitespace: true`。

**Tech Stack:** NestJS 11、class-validator、class-transformer、Jest、supertest、Prisma、OpenAPI 3、openapi-typescript、React 19、AntD 5、axios、Vitest。

**Spec:** `docs/superpowers/specs/2026-11-13-required-field-validation-design.md`

## Global Constraints

- 密码也 trim：含首尾空格的历史密码将无法登录，这是已确认的决策，不新增例外。
- 只改 HTTP 入参边界；服务层内部调用、业务规则校验（价格、时间冲突等）不动。
- multipart 中的 `Buffer`/流/文件对象不得被遍历或改写；`upload.spec.ts` 必须回归通过。
- 校验失败统一 HTTP 400 + `code=1001`（全局异常过滤器既有行为）。
- 更新接口语义：概念上必填的字符串字段，`undefined` 表示“不改”，传入 `null`/`''`/纯空格必须 400。
- 可选字段保持可空：`intro`、`detailRich`、`description`、`avatarUrl`、章节 `content`、`submit-attempt.answers`。
- 非测试代码的每个函数、变量都要有中文注释；测试文件不加注释。
- 每个任务结束提交一次；未经用户要求不推送远端。
- Windows 上 Jest 用 `--testPathPattern` 指定单个用例，避免 `testMatch` 反斜杠失配。

---

### 任务 1：后端 Trim 管道与单测

**Files:**
- Create: `backend/src/common/validation/trimming-validation.pipe.ts`
- Test: `backend/src/common/validation/trimming-validation.pipe.spec.ts`
- Modify: `backend/src/auth/dto/login.dto.ts`（本任务仅用于测试的 DTO 需先有 `@IsNotEmpty`，故提前改 `password`；其余字段在任务 3 处理）

**Interfaces:**
- Consumes: `@nestjs/common` 的 `ValidationPipe`、`ArgumentMetadata`。
- Produces:
  - `deepTrimStrings(value: unknown): unknown`
  - `class TrimmingValidationPipe extends ValidationPipe`，构造参数与 `ValidationPipe` 一致。

- [ ] **Step 1: 写失败测试**

创建 `backend/src/common/validation/trimming-validation.pipe.spec.ts`：

```ts
import { ArgumentMetadata } from '@nestjs/common';
import { LoginDto } from '../../auth/dto/login.dto';
import {
  deepTrimStrings,
  TrimmingValidationPipe,
} from './trimming-validation.pipe';

// 管道校验元数据：按 body + LoginDto 执行
const metadata: ArgumentMetadata = { type: 'body', metatype: LoginDto };

// 构造与测试文件一致的管道选项
const pipe = new TrimmingValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

describe('deepTrimStrings', () => {
  it('递归 trim 对象与数组中的字符串', () => {
    expect(
      deepTrimStrings({
        name: '  张三  ',
        list: ['  a  ', { text: '  b  ' }],
        count: 1,
        flag: true,
        empty: null,
      }),
    ).toEqual({
      name: '张三',
      list: ['a', { text: 'b' }],
      count: 1,
      flag: true,
      empty: null,
    });
  });

  it('Date、Buffer 与类实例原样保留', () => {
    // 保持引用的 Date
    const date = new Date('2026-01-01T00:00:00Z');
    // 保持引用的二进制缓冲
    const buffer = Buffer.from('  x  ');
    // 类实例（模拟 multer 文件对象等非纯对象）
    const instance = new (class Sample {
      value = '  y  ';
    })();
    const result = deepTrimStrings({ date, buffer, instance }) as {
      date: Date;
      buffer: Buffer;
      instance: { value: string };
    };
    expect(result.date).toBe(date);
    expect(result.buffer).toBe(buffer);
    expect(result.instance).toBe(instance);
    expect(result.instance.value).toBe('  y  ');
  });
});

describe('TrimmingValidationPipe', () => {
  it('纯空格字符串 trim 后触发 IsNotEmpty', async () => {
    await expect(
      pipe.transform({ email: 'a@b.com', password: '   ' }, metadata),
    ).rejects.toBeDefined();
  });

  it('合法值 trim 后通过并返回 DTO 实例', async () => {
    const result = (await pipe.transform(
      { email: '  a@b.com  ', password: '  Passw0rd1  ' },
      metadata,
    )) as LoginDto;
    expect(result).toBeInstanceOf(LoginDto);
    expect(result.email).toBe('a@b.com');
    expect(result.password).toBe('Passw0rd1');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd backend
npx jest --config jest.config.js --testPathPattern trimming-validation
```

预期：FAIL，`Cannot find module './trimming-validation.pipe'`。

- [ ] **Step 3: 写最小实现**

创建 `backend/src/common/validation/trimming-validation.pipe.ts`：

```ts
import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';

// 判断是否为纯对象：原型为 Object.prototype 或 null
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 递归去除字符串首尾空白；Date、Buffer、流与类实例原样返回
export function deepTrimStrings(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((item) => deepTrimStrings(item));
  if (!isPlainObject(value)) return value;
  // 新对象承接结果，避免修改调用方传入的原始对象
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = deepTrimStrings(item);
  }
  return result;
}

// 全局验证管道：先 trim 再走 class-validator，空白字符串等价于空串
export class TrimmingValidationPipe extends ValidationPipe {
  // metadata 原样透传，仅替换待校验的值
  override transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<unknown> {
    return super.transform(deepTrimStrings(value), metadata);
  }
}
```

同时给 `backend/src/auth/dto/login.dto.ts` 的 `password` 加 `@IsNotEmpty()`（完整改动见任务 3，这里先加 import 与 password 一项即可让测试变通过）：

```ts
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

  // 登录密码（登录时不重复校验强度）
  @IsString({ message: '密码必须是字符串' })
  @IsNotEmpty()
  password!: string;
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd backend
npx jest --config jest.config.js --testPathPattern trimming-validation
npx tsc --noEmit
```

预期：管道用例全绿，`tsc` 无输出。

- [ ] **Step 5: 提交**

```bash
git add backend/src/common/validation backend/src/auth/dto/login.dto.ts
git commit -m "feat(backend): 新增全局 Trim 验证管道"
```

---

### 任务 2：替换 17 处 ValidationPipe 注册点

**Files:**
- Modify: `backend/src/main.ts:2`（import）、`:60`（构造函数）
- Modify（12 个集成测试）：`backend/test/integration/{admin-catalog,auth,catalog,community,coupon,exam,flash-sale,groupon,jobs,learning,trade,upload}.spec.ts`
- Modify（2 个并发测试）：`backend/test/concurrency/{flash-sale-oversell,groupon-race}.spec.ts`
- Modify（2 个安全测试）：`backend/test/security/{community-xss,exam-answer-leak}.spec.ts`

**Interfaces:**
- Consumes: 任务 1 的 `TrimmingValidationPipe`。
- Produces: 生产与全部测试使用同一实现，避免口径漂移。

- [ ] **Step 1: main.ts**

第 2 行：

```ts
import { ValidationPipe } from '@nestjs/common';
```

改为：

```ts
import { TrimmingValidationPipe } from './common/validation/trimming-validation.pipe';
```

第 60 行：

```ts
    new ValidationPipe({
```

改为：

```ts
    new TrimmingValidationPipe({
```

- [ ] **Step 2: 修改 12 个集成测试**

除 `upload.spec.ts` 外其余 11 个文件的 import 形如：

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
```

改为：

```ts
import { INestApplication } from '@nestjs/common';
import { TrimmingValidationPipe } from '../../src/common/validation/trimming-validation.pipe';
```

`auth.spec.ts` 使用双引号，改为：

```ts
import { INestApplication } from "@nestjs/common";
import { TrimmingValidationPipe } from "../../src/common/validation/trimming-validation.pipe";
```

`upload.spec.ts` 第 1 行为：

```ts
import { ValidationPipe } from '@nestjs/common';
```

改为：

```ts
import { TrimmingValidationPipe } from '../../src/common/validation/trimming-validation.pipe';
```

然后把这 12 个文件中的 `new ValidationPipe({` 全部替换为 `new TrimmingValidationPipe({`（选项对象不动）。

- [ ] **Step 3: 修改 2 个并发与 2 个安全测试**

四个文件的 import 与 Step 2 的 11 个集成测试相同：

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
```

改为：

```ts
import { INestApplication } from '@nestjs/common';
import { TrimmingValidationPipe } from '../../src/common/validation/trimming-validation.pipe';
```

再把 `new ValidationPipe({` 改为 `new TrimmingValidationPipe({`。

- [ ] **Step 4: 确认没有遗漏**

```bash
cd backend
grep -rn "new ValidationPipe" src test
grep -rn "from '@nestjs/common'" test/integration test/concurrency test/security | grep ValidationPipe
npx tsc --noEmit
npx jest --config jest.config.js
```

预期：`grep` 只命中 `src/common/dto/page-query.dto.spec.ts`（该用例只测查询 DTO 转换，按设计保留 `ValidationPipe`）；`tsc` 无输出；单元测试全绿。

- [ ] **Step 5: 提交**

```bash
git add backend/src/main.ts backend/test
git commit -m "refactor(backend): 全部入口改用 TrimmingValidationPipe"
```

---

### 任务 3：认证 DTO 非空校验

**Files:**
- Modify: `backend/src/auth/dto/login.dto.ts`
- Modify: `backend/src/auth/dto/register.dto.ts`
- Modify: `backend/src/auth/dto/change-password.dto.ts`
- Test: `backend/src/auth/dto/{login,register,change-password}.dto.spec.ts`

**Interfaces:**
- Consumes: `class-validator` 的 `IsNotEmpty`。
- Produces: 登录/注册/改密的必填字符串对 `''` 直接拒绝；纯空格由任务 1 的管道 trim 后拒绝。

- [ ] **Step 1: 补失败用例**

`login.dto.spec.ts` 追加：

```ts
  it('邮箱或密码为空串被拒', async () => {
    await expect(
      validate(build({ email: '' })),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(build({ password: '' })),
    ).resolves.not.toHaveLength(0);
  });
```

`register.dto.spec.ts` 追加：

```ts
  it('必填字段为空串被拒', async () => {
    for (const override of [
      { email: '' },
      { password: '', confirmPassword: '' },
      { confirmPassword: '' },
      { nickname: '' },
    ]) {
      await expect(validate(build(override))).resolves.not.toHaveLength(0);
    }
  });
```

`change-password.dto.spec.ts` 追加：

```ts
  it('必填字段为空串被拒', async () => {
    await expect(
      validate(build({ currentPassword: '' })),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(build({ newPassword: '', confirmPassword: '' })),
    ).resolves.not.toHaveLength(0);
  });
```

注意：DTO 单测直接调用 `validate()`，不经过管道，所以只用 `''` 触发 `@IsNotEmpty`；纯空格场景由任务 1 的管道单测与任务 9 的集成用例覆盖。

- [ ] **Step 2: 运行确认失败**

```bash
cd backend
npx jest --config jest.config.js --testPathPattern "auth/dto"
```

预期：新增用例 FAIL（`currentPassword: ''`、`nickname: ''` 等仍通过校验）。

- [ ] **Step 3: 实现**

`login.dto.ts`：

```ts
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

// 登录请求 DTO：与 openapi LoginRequest 一致
export class LoginDto {
  // 登录邮箱
  @IsNotEmpty()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  // 登录密码（登录时不重复校验强度）
  @IsString({ message: '密码必须是字符串' })
  @IsNotEmpty()
  password!: string;
}
```

`register.dto.ts`：import 增加 `IsNotEmpty`，四个字符串字段各加 `@IsNotEmpty()`：

```ts
  // 登录邮箱
  @IsNotEmpty()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  // 密码：8–64 位，至少一个字母和一个数字（D6）
  @IsNotEmpty()
  @Matches(PASSWORD_REGEX, {
    message: '密码需为 8–64 位，且同时包含字母和数字',
  })
  password!: string;

  // 确认密码：必须与 password 一致
  @IsNotEmpty({ message: '确认密码不能为空' })
  @IsString({ message: '确认密码必须是字符串' })
  @Match('password', { message: '两次输入的密码不一致' })
  confirmPassword!: string;

  // 昵称：最长 30 字符
  @IsString({ message: '昵称必须是字符串' })
  @IsNotEmpty()
  @MaxLength(30, { message: '昵称不能超过 30 个字符' })
  nickname!: string;
```

`change-password.dto.ts`：import 增加 `IsNotEmpty`，三个字段各加 `@IsNotEmpty()`：

```ts
  // 当前密码（服务层校验是否正确）
  @IsString({ message: '当前密码必须是字符串' })
  @IsNotEmpty()
  currentPassword!: string;

  // 新密码：8–64 位，至少一个字母和一个数字（D6）
  @IsNotEmpty()
  @Matches(PASSWORD_REGEX, {
    message: '新密码需为 8–64 位，且同时包含字母和数字',
  })
  newPassword!: string;

  // 确认新密码：必须与 newPassword 一致
  @IsNotEmpty()
  @IsString({ message: '确认新密码必须是字符串' })
  @Match('newPassword', { message: '两次输入的密码不一致' })
  confirmPassword!: string;
```

- [ ] **Step 4: 运行确认通过**

```bash
cd backend
npx jest --config jest.config.js --testPathPattern "auth/dto"
npx tsc --noEmit
```

预期：全绿。

- [ ] **Step 5: 提交**

```bash
git add backend/src/auth/dto
git commit -m "feat(backend): 认证接口必填字段拒绝空值"
```

---

### 任务 4：用户资料昵称非空

**Files:**
- Modify: `backend/src/users/dto/update-profile.dto.ts`
- Create: `backend/src/users/dto/update-profile.dto.spec.ts`

**Interfaces:**
- Consumes: `class-validator`。
- Produces: `ProfileUpdateRequest.nickname` 拒绝 `''`；`avatarUrl` 仍允许 `null`。

- [ ] **Step 1: 写失败测试**

创建 `backend/src/users/dto/update-profile.dto.spec.ts`：

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './update-profile.dto';

// 构造资料 DTO：默认昵称与性别合法
function build(overrides: Partial<UpdateProfileDto> = {}): UpdateProfileDto {
  return plainToInstance(UpdateProfileDto, {
    nickname: '小知',
    gender: 'male',
    ...overrides,
  });
}

describe('UpdateProfileDto', () => {
  it('合法参数校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('昵称缺失或为空串被拒', async () => {
    await expect(
      validate(plainToInstance(UpdateProfileDto, { gender: 'male' })),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(build({ nickname: '' })),
    ).resolves.not.toHaveLength(0);
  });

  it('头像可以传 null 清空', async () => {
    await expect(
      validate(build({ avatarUrl: null })),
    ).resolves.toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend
npx jest --config jest.config.js --testPathPattern update-profile
```

预期：`nickname: ''` 用例 FAIL。

- [ ] **Step 3: 实现**

`backend/src/users/dto/update-profile.dto.ts`：

```ts
import { Gender } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// 修改资料请求 DTO：与 openapi ProfileUpdateRequest 一致
export class UpdateProfileDto {
  // 昵称：最长 30 字符，必填
  @IsString({ message: '昵称必须是字符串' })
  @IsNotEmpty()
  @MaxLength(30, { message: '昵称不能超过 30 个字符' })
  nickname!: string;

  // 头像 URL：可选；传 null 表示清空头像
  @IsOptional()
  @IsString({ message: '头像地址必须是字符串' })
  @MaxLength(500, { message: '头像地址过长' })
  avatarUrl?: string | null;

  // 性别：male / female / secret，必填
  @IsEnum(Gender, { message: '性别取值不合法' })
  gender!: Gender;
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd backend
npx jest --config jest.config.js --testPathPattern update-profile
```

预期：全绿。

- [ ] **Step 5: 提交**

```bash
git add backend/src/users/dto
git commit -m "feat(backend): 用户昵称拒绝空值"
```

---

### 任务 5：考试、题目与章节排序 DTO

**Files:**
- Modify: `backend/src/exam/dto/create-question.dto.ts`
- Modify: `backend/src/exam/dto/create-exam.dto.ts`
- Modify: `backend/src/exam/dto/update-exam.dto.ts`
- Modify: `backend/src/exam/dto/update-question.dto.ts`
- Modify: `backend/src/catalog/dto/reorder-chapters.dto.ts`
- Create: `backend/src/exam/dto/{create-question,create-exam,update-exam,update-question}.dto.spec.ts`
- Create: `backend/src/catalog/dto/reorder-chapters.dto.spec.ts`

**Interfaces:**
- Consumes: `class-validator` 的 `IsNotEmpty`、`ArrayNotEmpty`、`ValidateIf`。
- Produces:
  - 创建题目 `analysis` 拒绝 `''`、`answer[]` 元素拒绝 `''`。
  - 创建考试 `questionIds` 拒绝空数组；章节重排 `orderedChapterIds` 拒绝空数组。
  - 更新考试/题目的概念必填字段：`undefined` 跳过，`null`/`''`/空格 拒绝。

- [ ] **Step 1: 写失败测试**

创建 `backend/src/exam/dto/create-question.dto.spec.ts`：

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateQuestionDto } from './create-question.dto';

// 构造题目 DTO：默认合法单选
function build(
  overrides: Partial<CreateQuestionDto> = {},
): CreateQuestionDto {
  return plainToInstance(CreateQuestionDto, {
    type: 'single',
    stem: '1+1=?',
    options: [
      { key: 'A', text: '2' },
      { key: 'B', text: '3' },
    ],
    answer: ['A'],
    analysis: '显然',
    score: 5,
    ...overrides,
  });
}

describe('CreateQuestionDto', () => {
  it('合法参数校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('解析缺失或为空串被拒', async () => {
    await expect(
      validate(build({ analysis: '' })),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(
        plainToInstance(CreateQuestionDto, {
          type: 'single',
          stem: '1+1=?',
          options: [
            { key: 'A', text: '2' },
            { key: 'B', text: '3' },
          ],
          answer: ['A'],
          score: 5,
        }),
      ),
    ).resolves.not.toHaveLength(0);
  });

  it('答案元素不得为空串', async () => {
    await expect(
      validate(build({ answer: [''] })),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(build({ answer: ['A', ''] })),
    ).resolves.not.toHaveLength(0);
  });
});
```

创建 `backend/src/exam/dto/create-exam.dto.spec.ts`：

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateExamDto } from './create-exam.dto';

// 构造考试 DTO：默认标题与组卷合法
function build(overrides: Partial<CreateExamDto> = {}): CreateExamDto {
  return plainToInstance(CreateExamDto, {
    title: '期中测验',
    durationMin: 30,
    passScore: 10,
    questionIds: [1, 2],
    ...overrides,
  });
}

describe('CreateExamDto', () => {
  it('合法参数校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('标题为空串被拒', async () => {
    await expect(
      validate(build({ title: '' })),
    ).resolves.not.toHaveLength(0);
  });

  it('题目 id 为空数组被拒', async () => {
    await expect(
      validate(build({ questionIds: [] })),
    ).resolves.not.toHaveLength(0);
  });
});
```

创建 `backend/src/exam/dto/update-exam.dto.spec.ts`：

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateExamDto } from './update-exam.dto';

// 构造编辑考试 DTO：默认只带版本号
function build(overrides: Partial<UpdateExamDto> = {}): UpdateExamDto {
  return plainToInstance(UpdateExamDto, { version: 1, ...overrides });
}

describe('UpdateExamDto', () => {
  it('只传版本号可通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('标题传空串或 null 被拒', async () => {
    await expect(
      validate(build({ title: '' })),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(build({ title: null as unknown as string })),
    ).resolves.not.toHaveLength(0);
  });

  it('questionIds 传空数组被拒，不传可通过', async () => {
    await expect(
      validate(build({ questionIds: [] })),
    ).resolves.not.toHaveLength(0);
    await expect(validate(build())).resolves.toHaveLength(0);
  });
});
```

创建 `backend/src/exam/dto/update-question.dto.spec.ts`：

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateQuestionDto } from './update-question.dto';

// 构造编辑题目 DTO：默认只带版本号
function build(
  overrides: Partial<UpdateQuestionDto> = {},
): UpdateQuestionDto {
  return plainToInstance(UpdateQuestionDto, { version: 1, ...overrides });
}

describe('UpdateQuestionDto', () => {
  it('只传版本号可通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('题干或解析传空串、null 被拒', async () => {
    for (const override of [
      { stem: '' },
      { stem: null as unknown as string },
      { analysis: '' },
      { analysis: null as unknown as string },
    ]) {
      await expect(validate(build(override))).resolves.not.toHaveLength(0);
    }
  });

  it('答案传空数组或空串元素被拒', async () => {
    await expect(
      validate(build({ answer: [] })),
    ).resolves.not.toHaveLength(0);
    await expect(
      validate(build({ answer: [''] })),
    ).resolves.not.toHaveLength(0);
  });
});
```

创建 `backend/src/catalog/dto/reorder-chapters.dto.spec.ts`：

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ReorderChaptersDto } from './reorder-chapters.dto';

// 构造排序 DTO：默认两个章节 id
function build(
  overrides: Partial<ReorderChaptersDto> = {},
): ReorderChaptersDto {
  return plainToInstance(ReorderChaptersDto, {
    orderedChapterIds: [1, 2],
    ...overrides,
  });
}

describe('ReorderChaptersDto', () => {
  it('合法参数校验通过', async () => {
    await expect(validate(build())).resolves.toHaveLength(0);
  });

  it('空数组被拒', async () => {
    await expect(
      validate(build({ orderedChapterIds: [] })),
    ).resolves.not.toHaveLength(0);
  });

  it('重复 id 被拒', async () => {
    await expect(
      validate(build({ orderedChapterIds: [1, 1] })),
    ).resolves.not.toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

```bash
cd backend
npx jest --config jest.config.js --testPathPattern "exam/dto|reorder-chapters"
```

预期：解析空串、答案空元素、空组卷、空排序、更新空值等新用例 FAIL。

- [ ] **Step 3: 实现**

`create-question.dto.ts`：`answer` 增加 `@IsNotEmpty({ each: true })`，`analysis` 增加 `@IsNotEmpty()`：

```ts
  // 正确答案：单选恰好 1 个；多选至少 2 个
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  answer!: string[];

  // 答案解析（仅交卷后返回）
  @IsString()
  @IsNotEmpty()
  analysis!: string;
```

`create-exam.dto.ts`：import 增加 `ArrayNotEmpty`，`questionIds` 增加 `@ArrayNotEmpty()`：

```ts
  // 组卷题目 id（按顺序出题；分值不可在组卷时修改）
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  questionIds!: number[];
```

`update-exam.dto.ts` 整体替换为：

```ts
import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

// 编辑考试请求：对应 openapi ExamUpdateRequest，仅草稿可编辑
export class UpdateExamDto {
  // 乐观锁版本号，必须与当前记录一致
  @IsInt()
  @Min(1)
  version!: number;

  // 考试名称：不传表示不改，传入时不可为 null 或空串
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  title?: string;

  // 考试说明
  @IsOptional()
  @IsString()
  description?: string;

  // 考试时长（分钟）
  @IsOptional()
  @IsInt()
  @Min(1)
  durationMin?: number;

  // 及格分：修改后仍需大于 0 且不超过总分
  @IsOptional()
  @IsInt()
  @Min(1)
  passScore?: number;

  // 重新组卷：不传表示不改，传入时不可为空数组
  @ValidateIf((_dto, value) => value !== undefined)
  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  questionIds?: number[];
}
```

`update-question.dto.ts` 的 `stem`/`analysis`/`answer` 段替换为：

```ts
  // 题干：不传表示不改，传入时不可为 null 或空串
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  stem?: string;

  // 选项：2~6 个，key 不可重复
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[];

  // 正确答案：不传表示不改，传入时不可为空数组或空串元素
  @ValidateIf((_dto, value) => value !== undefined)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  answer?: string[];

  // 答案解析：不传表示不改，传入时不可为 null 或空串
  @ValidateIf((_dto, value) => value !== undefined)
  @IsString()
  @IsNotEmpty()
  analysis?: string;
```

import 增加 `ArrayNotEmpty`、`IsNotEmpty`、`ValidateIf`。

`reorder-chapters.dto.ts` 整体替换为：

```ts
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
} from 'class-validator';

// 章节排序请求：对应 openapi ChapterReorderRequest
export class ReorderChaptersDto {
  // 全部章节 id 的新顺序，保存后从 1 连续编号
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  orderedChapterIds!: number[];
}
```

- [ ] **Step 4: 运行确认通过**

```bash
cd backend
npx jest --config jest.config.js --testPathPattern "exam/dto|reorder-chapters"
npx tsc --noEmit
```

预期：全绿。

- [ ] **Step 5: 提交**

```bash
git add backend/src/exam/dto backend/src/catalog/dto
git commit -m "feat(backend): 考试题目与章节排序必填校验"
```

---

### 任务 6：OpenAPI 契约与前端类型

**Files:**
- Modify: `backend/openapi.yaml`
- Regenerate: `frontend/src/api/schema.d.ts`

**Interfaces:**
- Consumes: 任务 3–5 的 DTO 语义。
- Produces: 契约 `minLength: 1` / `minItems: 1` 与实现一致；前端类型重新生成。

- [ ] **Step 1: 修改内联 schema**

`RegisterRequest`（约 210 行）：

```yaml
        email: { type: string, format: email, minLength: 1 }
        password: { type: string, minLength: 8, maxLength: 64, description: D6 已决：8–64 位，鼓励混合字符 }
        confirmPassword: { type: string, minLength: 1 }
        nickname: { type: string, minLength: 1, maxLength: 30 }
```

`LoginRequest`：

```yaml
        email: { type: string, format: email, minLength: 1 }
        password: { type: string, minLength: 1 }
```

`ChangePasswordRequest`：

```yaml
        currentPassword: { type: string, minLength: 1 }
        newPassword: { type: string, minLength: 8, maxLength: 64 }
        confirmPassword: { type: string, minLength: 1 }
```

`ProfileUpdateRequest`：

```yaml
        nickname: { type: string, minLength: 1, maxLength: 30 }
```

`ChapterReorderRequest`：

```yaml
        orderedChapterIds:
          type: array
          minItems: 1
          items: { type: integer }
          description: 全部章节 id 的新顺序；保存后从 1 连续编号
```

`QuestionCreateRequest`：

```yaml
        stem: { type: string, minLength: 1 }
        options: { type: array, minItems: 2, maxItems: 6, items: { type: object, properties: { key: { type: string, minLength: 1 }, text: { type: string, minLength: 1 } } } }
        answer: { type: array, minItems: 1, items: { type: string, minLength: 1 } }
        analysis: { type: string, minLength: 1 }
```

`QuestionUpdateRequest`：

```yaml
        stem: { type: string, minLength: 1, description: 传入时不可为空 }
        options: { type: array, minItems: 2, maxItems: 6, items: { type: object, properties: { key: { type: string, minLength: 1 }, text: { type: string, minLength: 1 } } } }
        answer: { type: array, minItems: 1, items: { type: string, minLength: 1 }, description: 传入时不可为空 }
        analysis: { type: string, minLength: 1, description: 传入时不可为空 }
```

`ExamCreateRequest`：

```yaml
        title: { type: string, minLength: 1 }
        questionIds: { type: array, minItems: 1, items: { type: integer }, description: 选题并定序；组卷不改分值，总分=分值之和 }
```

`ExamUpdateRequest`：

```yaml
        title: { type: string, minLength: 1, description: 传入时不可为空 }
        questionIds: { type: array, minItems: 1, items: { type: integer }, description: 传入时不可为空；按新顺序重写草稿快照 }
```

- [ ] **Step 2: 重新生成前端类型**

```bash
cd frontend
npm run gen:api
git diff --stat src/api/schema.d.ts
```

预期：只有 description 注释与 `minLength` 相关的注释变化，无类型结构破坏。

- [ ] **Step 3: 类型检查**

```bash
cd frontend
npm run typecheck
```

预期：无错误。

- [ ] **Step 4: 提交**

```bash
git add backend/openapi.yaml frontend/src/api/schema.d.ts
git commit -m "docs(api): 必填字段补齐 minLength 与 minItems"
```

---

### 任务 7：前端 trimDeep 与请求拦截器

**Files:**
- Create: `frontend/src/api/trim.ts`
- Create: `frontend/tests/api/trim.test.ts`
- Modify: `frontend/src/api/client.ts:5`（import）、`:29-33`（请求拦截器）
- Modify: `frontend/tests/api/client.test.ts`（追加拦截器用例）

**Interfaces:**
- Consumes: axios 请求配置 `config.data`、`config.params`。
- Produces:
  - `trimDeep<T>(value: T): T`
  - `isPlainObject(value: unknown): value is Record<string, unknown>`

- [ ] **Step 1: 写失败测试**

创建 `frontend/tests/api/trim.test.ts`：

```ts
import { trimDeep } from '@/api/trim';

describe('trimDeep', () => {
  it('递归 trim 对象与数组中的字符串', () => {
    expect(
      trimDeep({
        name: '  张三  ',
        list: ['  a  ', { text: '  b  ' }],
        count: 1,
        flag: true,
        empty: null,
      }),
    ).toEqual({
      name: '张三',
      list: ['a', { text: 'b' }],
      count: 1,
      flag: true,
      empty: null,
    });
  });

  it('Date 与 FormData 原样保留', () => {
    // 保持引用的日期
    const date = new Date('2026-01-01T00:00:00Z');
    // 带空格的表单对象
    const form = new FormData();
    form.append('name', '  x  ');
    const result = trimDeep({ date, form });
    expect(result.date).toBe(date);
    expect(result.form).toBe(form);
    expect(form.get('name')).toBe('  x  ');
  });
});
```

在 `frontend/tests/api/client.test.ts` 末尾追加：

```ts
  it('请求体与查询参数在发送前被 trim', async () => {
    // 服务端实际收到的查询串
    let seenUrl = '';
    // 服务端实际收到的 JSON
    let seenBody: unknown = null;
    server.use(
      http.post(/\/api\/v1\/echo$/, async ({ request }) => {
        seenUrl = request.url;
        seenBody = await request.json();
        return HttpResponse.json({
          code: 0,
          message: 'ok',
          data: null,
          requestId: 'r7',
        });
      }),
    );
    await request({
      url: '/echo',
      method: 'post',
      params: { q: '  hi  ' },
      data: { name: ' 张三 ', nested: [' a '] },
    });
    expect(seenUrl).toContain('q=hi');
    expect(seenBody).toEqual({ name: '张三', nested: ['a'] });
  });
```

- [ ] **Step 2: 运行确认失败**

```bash
cd frontend
npx vitest run tests/api/trim.test.ts tests/api/client.test.ts
```

预期：`trim.test.ts` 因模块不存在失败；`client.test.ts` 的 trim 断言失败。

- [ ] **Step 3: 实现**

创建 `frontend/src/api/trim.ts`：

```ts
// 判断是否为纯对象：原型为 Object.prototype 或 null
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// 递归去除字符串首尾空白；FormData、Blob、Date 等非纯对象原样返回
export function trimDeep<T>(value: T): T {
  if (typeof value === 'string') return value.trim() as T;
  if (Array.isArray(value)) return value.map((item) => trimDeep(item)) as T;
  if (!isPlainObject(value)) return value;
  // 新对象承接结果，避免修改调用方数据
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = trimDeep(item);
  }
  return result as T;
}
```

修改 `frontend/src/api/client.ts`：第 5 行后增加

```ts
import { isPlainObject, trimDeep } from './trim';
```

请求拦截器改为：

```ts
// 请求开始：纯对象/数组载荷先 trim，再累加全局加载计数
apiClient.interceptors.request.use((config) => {
  if (Array.isArray(config.data) || isPlainObject(config.data)) {
    config.data = trimDeep(config.data);
  }
  if (isPlainObject(config.params)) {
    config.params = trimDeep(config.params);
  }
  useRequestActivityStore.getState().startRequest();
  return config;
});
```

- [ ] **Step 4: 运行确认通过**

```bash
cd frontend
npx vitest run tests/api/trim.test.ts tests/api/client.test.ts
npm run typecheck
```

预期：全绿。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/api/trim.ts frontend/src/api/client.ts frontend/tests/api/trim.test.ts frontend/tests/api/client.test.ts
git commit -m "feat(frontend): 请求层统一 trim 字符串"
```

---

### 任务 8：前端表单 whitespace 规则

**Files:**
- Modify: `frontend/src/features/auth/LoginPage.tsx:73,88`
- Modify: `frontend/src/features/auth/RegisterPage.tsx:59,74,90,105`
- Modify: `frontend/src/features/user-center/PasswordPage.tsx:61,69,88`
- Modify: `frontend/src/features/user-center/ProfilePage.tsx:90`
- Modify: `frontend/src/features/admin/courses/BasicInfoForm.tsx:173,212`
- Modify: `frontend/src/features/admin/courses/CourseCreatePage.tsx:100,139`
- Modify: `frontend/src/features/admin/courses/ChapterPanel.tsx:303`
- Modify: `frontend/src/features/admin/exams/ExamForm.tsx:55`
- Modify: `frontend/src/features/admin/questions/QuestionForm.tsx:101,124,198`
- Modify: `frontend/src/features/admin/blocked-words/BlockedWordFormModal.tsx:78`

**Interfaces:**
- Consumes: AntD Form `Rule` 的 `whitespace` 选项。
- Produces: 字符串必填项在输入阶段拒绝纯空格；数字/选择/上传类规则不变。

- [ ] **Step 1: 逐文件替换**

`LoginPage.tsx`：

```ts
            { required: true, whitespace: true, message: '请输入邮箱' },
```

```ts
            { required: true, whitespace: true, message: '请输入密码' },
```

`RegisterPage.tsx`：

```ts
            { required: true, whitespace: true, message: '请输入邮箱' },
            { required: true, whitespace: true, message: '请输入密码' },
            { required: true, whitespace: true, message: '请再次输入密码' },
            { required: true, whitespace: true, message: '请输入昵称' },
```

`PasswordPage.tsx`：

```ts
            rules={[{ required: true, whitespace: true, message: '请输入当前密码' }]}
```

```ts
              { required: true, whitespace: true, message: '请输入新密码' },
              { required: true, whitespace: true, message: '请再次输入新密码' },
```

`ProfilePage.tsx`：

```ts
            rules={[
              { required: true, whitespace: true, message: '请输入昵称' },
              { max: 30, message: '昵称最多 30 个字符' },
            ]}
```

`BasicInfoForm.tsx`：

```ts
            { required: true, whitespace: true, message: '请输入课程名称' },
            rules={[{ required: true, whitespace: true, message: '请输入讲师' }]}
```

`CourseCreatePage.tsx`：

```ts
              { required: true, whitespace: true, message: '请输入课程名称' },
            rules={[{ required: true, whitespace: true, message: '请输入讲师' }]}
```

`ChapterPanel.tsx`：

```ts
              { required: true, whitespace: true, message: '请输入章节标题' },
```

`ExamForm.tsx`：

```ts
        rules={[{ required: true, whitespace: true, message: '请输入考试名称' }]}
```

`QuestionForm.tsx`：

```ts
        rules={[{ required: true, whitespace: true, message: '请输入题干' }]}
                    rules={[{ required: true, whitespace: true, message: '请输入选项内容' }]}
        rules={[{ required: true, whitespace: true, message: '请输入答案解析' }]}
```

`BlockedWordFormModal.tsx`：

```ts
            { required: true, whitespace: true, message: '请输入屏蔽词' },
```

`CouponFormFields.tsx`、`FlashSaleFormDrawer.tsx`、`GrouponFormDrawer.tsx` 已有 `whitespace: true`，不再改动。

- [ ] **Step 2: 确认没有漏改**

```bash
cd frontend
grep -rn "required: true," src/features --include=*.tsx | grep -v whitespace
```

预期：只剩数字、选择、上传类规则（如原价、售价、课程类型、封面、考试时长、及格分、分值、时间、库存、面额、关联课程、成团人数等）。

- [ ] **Step 3: 运行回归**

```bash
cd frontend
npm run typecheck
npm run test
```

预期：类型检查与现有表单/组件测试全绿；若有断言文案或提交载荷的用例，按“trim 后提交”更新。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/features
git commit -m "feat(frontend): 表单字符串必填项拒绝纯空格"
```

---

### 任务 9：集成 HTTP 用例

**Files:**
- Modify: `backend/test/integration/auth.spec.ts`
- Modify: `backend/test/integration/exam.spec.ts`
- Modify: `backend/test/integration/admin-catalog.spec.ts`

**Interfaces:**
- Consumes: 任务 1 的管道、任务 3–5 的 DTO。
- Produces: 端到端证明空白输入 400/1001、正常输入落库已 trim。

- [ ] **Step 1: 先写失败用例**

`auth.spec.ts`：

1. 注册用例的 nickname 改为带首尾空格（后续“个人资料可读可改”断言 `nickname: "测试一"`，同时验证落库已 trim）：

```ts
        nickname: "  测试一  ",
```

2. “个人资料可读可改”用例的成功更新后追加：

```ts
    const blankNickname = await agent
      .put("/api/v1/user/profile")
      .send({ nickname: "   ", gender: "male" })
      .expect(400);
    expect(blankNickname.body.code).toBe(1001);
```

3. 文件末尾（`describe` 内）新增：

```ts
  it("必填字段为纯空格时返回 400（code=1001）", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email: `blank-${Date.now()}@test.com`, password: "   " })
      .expect(400);
    expect(login.body.code).toBe(1001);

    const register = await request(app.getHttpServer())
      .post("/api/v1/auth/register")
      .send({
        email: `blank-${Date.now()}@test.com`,
        password: "Passw0rd1",
        confirmPassword: "Passw0rd1",
        nickname: "   ",
      })
      .expect(400);
    expect(register.body.code).toBe(1001);
  });
```

`exam.spec.ts` 末尾新增：

```ts
  it('必填字段空白或空数组返回 400（code=1001）', async () => {
    const blankTitle = await admin
      .post('/api/v1/admin/exams')
      .send({
        title: '   ',
        durationMin: 30,
        passScore: 5,
        questionIds: [singleQid],
      })
      .expect(400);
    expect(blankTitle.body.code).toBe(1001);

    const emptyPaper = await admin
      .post('/api/v1/admin/exams')
      .send({
        title: `空卷 ${SUFFIX}`,
        durationMin: 30,
        passScore: 5,
        questionIds: [],
      })
      .expect(400);
    expect(emptyPaper.body.code).toBe(1001);

    const blankAnalysis = await admin
      .post('/api/v1/admin/questions')
      .send({
        type: 'single',
        stem: `空白解析 ${SUFFIX}`,
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
        ],
        answer: ['A'],
        analysis: '   ',
        score: 5,
      })
      .expect(400);
    expect(blankAnalysis.body.code).toBe(1001);

    const blankAnswer = await admin
      .post('/api/v1/admin/questions')
      .send({
        type: 'single',
        stem: `空白答案 ${SUFFIX}`,
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
        ],
        answer: [''],
        analysis: '解析',
        score: 5,
      })
      .expect(400);
    expect(blankAnswer.body.code).toBe(1001);

    const draft = await admin
      .post('/api/v1/admin/exams')
      .send({
        title: `待编辑 ${SUFFIX}`,
        durationMin: 30,
        passScore: 5,
        questionIds: [singleQid],
      })
      .expect(201);

    const blankUpdateTitle = await admin
      .put(`/api/v1/admin/exams/${draft.body.data.id}`)
      .send({ version: draft.body.data.version, title: '   ' })
      .expect(400);
    expect(blankUpdateTitle.body.code).toBe(1001);

    const emptyUpdatePaper = await admin
      .put(`/api/v1/admin/exams/${draft.body.data.id}`)
      .send({ version: draft.body.data.version, questionIds: [] })
      .expect(400);
    expect(emptyUpdatePaper.body.code).toBe(1001);

    const blankStem = await admin
      .put(`/api/v1/admin/questions/${singleQid}`)
      .send({ version: 1, stem: '   ' })
      .expect(400);
    expect(blankStem.body.code).toBe(1001);

    const emptyUpdateAnswer = await admin
      .put(`/api/v1/admin/questions/${singleQid}`)
      .send({ version: 1, answer: [] })
      .expect(400);
    expect(emptyUpdateAnswer.body.code).toBe(1001);
  });
```

`admin-catalog.spec.ts` 的“讲师与封面缺失或为空…”用例中追加（复用 `created` 课程）：

```ts
    const blankName = await agent
      .post('/api/v1/admin/courses')
      .send({
        ...base,
        name: '   ',
        instructor: '王老师',
        coverUrl: 'image/2026/11/12/cover.png',
      })
      .expect(400);
    expect(blankName.body.code).toBe(1001);

    const emptyOrder = await agent
      .post(`/api/v1/admin/courses/${created.body.data.id}/chapters/reorder`)
      .send({ orderedChapterIds: [] })
      .expect(400);
    expect(emptyOrder.body.code).toBe(1001);
```

- [ ] **Step 2: 运行确认失败（在未实现时）**

若此时尚未执行任务 1–5，应先完成它们。实现完成后直接进入 Step 3。

- [ ] **Step 3: 运行集成用例**

```bash
cd backend
npm run test:all -- --testPathPattern "integration/(auth|exam|admin-catalog)"
```

预期：全绿。若本机没有 Postgres/Redis，记录“未运行”，交由 CI 验证，并在提交信息中注明。

- [ ] **Step 4: 提交**

```bash
git add backend/test/integration
git commit -m "test(backend): 必填字段空值集成用例"
```

---

### 任务 10：全量回归与本地验证

**Files:**
- 无代码改动（仅验证）。

**Interfaces:**
- Consumes: 任务 1–9 的全部产物。
- Produces: 验收证据。

- [ ] **Step 1: 后端静态检查与单测**

```bash
cd backend
npx tsc --noEmit
npx jest --config jest.config.js
```

预期：无类型错误；单元测试全绿。

- [ ] **Step 2: 全部集成/并发/安全测试**

```bash
cd backend
npm run test:all
```

预期：全绿；重点确认 `upload.spec.ts`（multipart）与 `exam-answer-leak.spec.ts` 不受影响。

- [ ] **Step 3: 前端回归**

```bash
cd frontend
npm run typecheck
npm run test
```

预期：全绿。

- [ ] **Step 4: 本地 e4f49c 验证（需用户确认同步后执行）**

1. 在 `E:/frontend/online-education-qoder` 完成提交后，进入 e4f49c 工作树做 ff 合并：

```bash
git -C <e4f49c 路径> merge --ff-only main
```

2. 触发 nest watch 重建：

```bash
touch backend/src/main.ts
```

3. 线上冒烟：

```bash
curl -i -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"probe@test.com","password":"   "}'
```

预期：HTTP 400，响应体 `"code":1001`。

再验证 trim 落库：注册一个昵称带空格的临时账号，登录后读取 `/api/v1/user/profile`，`nickname` 无首尾空格。

- [ ] **Step 5: 汇总验证结果**

在最终回复中列出：执行过的命令、通过/未运行项、未运行原因。未执行的测试必须明确标注，不得默认通过。

---

## 自查记录

- 规格覆盖：D1（范围）、D2（管道）、D3（存储 trim）、D4（更新语义）、D5（可空字段）、D6（必填数组）、D7（前端拦截器）、D8（whitespace）、D9（契约）均有对应任务。
- 占位符：无 TBD/TODO；每个改动步骤均给出可执行代码。
- 类型一致性：后端 `deepTrimStrings` / `TrimmingValidationPipe`、前端 `trimDeep` / `isPlainObject` 在定义与使用处一致；DTO 字段名与 OpenAPI 一致。
