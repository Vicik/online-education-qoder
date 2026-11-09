import { Injectable } from '@nestjs/common';
import { EnabledStatus, Prisma, Question, QuestionType } from '@prisma/client';
import {
  AuditContext,
  AuditService,
  recordAudit,
} from '../../audit/audit.service';
import { ErrorCode } from '../../common/constants/error-codes';
import { PageQuery } from '../../common/dto/page-query.dto';
import { PageResult } from '../../common/dto/page-result';
import { BizException } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateQuestionDto,
  QuestionOptionDto,
} from '../dto/create-question.dto';
import { UpdateQuestionDto } from '../dto/update-question.dto';

// 选项数量下限
const OPTION_MIN = 2;
// 选项数量上限
const OPTION_MAX = 6;
// 乐观锁冲突提示：与其他管理端模块保持一致
const VERSION_CONFLICT_MESSAGE = '数据已被修改，请刷新后重试';

// 管理端题目视图：含答案与解析，仅管理端接口返回
export interface QuestionAdminView {
  id: number; // 题目 id
  type: QuestionType; // 单选/多选
  stem: string; // 题干
  options: QuestionOptionDto[]; // 选项
  score: number; // 分值
  answer: string[]; // 正确答案
  analysis: string; // 答案解析
  status: EnabledStatus; // 启用/停用
  version: number; // 乐观锁版本
  createdAt: Date; // 创建时间
  updatedAt: Date; // 更新时间
}

// 列表筛选条件：题型与状态均可选
export interface QuestionListFilter {
  type?: QuestionType; // 题型筛选
  status?: EnabledStatus; // 状态筛选
}

// 将 JSON 选项安全转换为选项数组
function toOptions(value: Prisma.JsonValue): QuestionOptionDto[] {
  // 非数组数据一律视为空选项，避免脏数据导致接口异常
  return Array.isArray(value) ? (value as unknown as QuestionOptionDto[]) : [];
}

// 将 JSON 答案安全转换为字符串数组
function toAnswers(value: Prisma.JsonValue): string[] {
  // 仅保留字符串元素
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

// 题目行转为管理端视图
function toAdminView(row: Question): QuestionAdminView {
  return {
    id: row.id,
    type: row.type,
    stem: row.stem,
    options: toOptions(row.options),
    score: row.score,
    answer: toAnswers(row.answer),
    analysis: row.analysis,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// 校验题目内容规则：选项 2~6 个且 key 唯一、答案来自选项、题型与答案数量匹配
function assertQuestionRules(
  type: QuestionType, // 题型
  options: QuestionOptionDto[], // 选项
  answer: string[], // 正确答案
): void {
  // 选项数量边界
  if (options.length < OPTION_MIN || options.length > OPTION_MAX) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      `选项数量须为 ${OPTION_MIN}~${OPTION_MAX} 个`,
      422,
    );
  }

  // 选项 key 集合
  const optionKeys = options.map((option) => option.key);
  // 选项 key 不可为空且不可重复
  if (
    optionKeys.some((key) => !key) ||
    new Set(optionKeys).size !== optionKeys.length
  ) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      '选项 key 不可为空且不可重复',
      422,
    );
  }

  // 答案不可重复
  if (new Set(answer).size !== answer.length) {
    throw new BizException(ErrorCode.PARAM_INVALID, '答案不可重复', 422);
  }

  // 答案必须是已存在的选项 key
  for (const key of answer) {
    if (!optionKeys.includes(key)) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        `答案「${key}」不在选项中`,
        422,
      );
    }
  }

  // 单选恰好 1 个答案；多选至少 2 个答案
  if (type === 'single' && answer.length !== 1) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      '单选题必须恰好有 1 个答案',
      422,
    );
  }
  if (type === 'multiple' && answer.length < 2) {
    throw new BizException(
      ErrorCode.PARAM_INVALID,
      '多选题至少需要 2 个答案',
      422,
    );
  }
}

// 题目管理端服务：题库 CRUD、启停与审计
@Injectable()
export class QuestionAdminService {
  // 构造函数：注入数据库与审计服务
  constructor(
    private readonly prisma: PrismaService, // 数据库访问
    private readonly audit: AuditService, // 管理端操作留痕
  ) {}

  // 管理端题目列表：分页 + 题型/状态筛选，含答案与解析
  async list(
    page: PageQuery,
    filter: QuestionListFilter = {},
  ): Promise<PageResult<QuestionAdminView>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;
    // 查询条件：仅收集已提供的筛选项
    const where: Prisma.QuestionWhereInput = {
      ...(filter.type === undefined ? {} : { type: filter.type }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
    };

    // 当前页题目与总数
    const [rows, total] = await Promise.all([
      this.prisma.question.findMany({
        where,
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.question.count({ where }),
    ]);

    return {
      items: rows.map(toAdminView),
      total,
      page: pageNo,
      pageSize,
    };
  }

  // 创建题目：校验规则后落库，默认启用；分值仅创建时确定
  async create(
    dto: CreateQuestionDto,
    context?: AuditContext,
  ): Promise<QuestionAdminView> {
    // 服务层兜底校验：分值必须为正整数
    if (!Number.isInteger(dto.score) || dto.score < 1) {
      throw new BizException(
        ErrorCode.PARAM_INVALID,
        '分值必须为不小于 1 的整数',
        422,
      );
    }
    // 选项/答案/题型规则
    assertQuestionRules(dto.type, dto.options, dto.answer);

    // 创建题目（默认启用）
    const created = await this.prisma.question.create({
      data: {
        type: dto.type,
        stem: dto.stem,
        options: dto.options as unknown as Prisma.InputJsonValue,
        answer: dto.answer as unknown as Prisma.InputJsonValue,
        analysis: dto.analysis,
        score: dto.score,
        status: 'enabled',
      },
    });

    await recordAudit(this.audit, context, {
      action: 'question.create',
      targetType: 'question',
      targetId: created.id,
      after: created,
    });

    return toAdminView(created);
  }

  // 题目详情：不存在返回 404
  async getDetail(questionId: number): Promise<QuestionAdminView> {
    // 当前题目
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '题目不存在', 404);
    }
    return toAdminView(question);
  }

  // 编辑题目：version 乐观锁；score 入参被忽略，分值不可改
  async update(
    questionId: number,
    dto: UpdateQuestionDto,
    context?: AuditContext,
  ): Promise<QuestionAdminView> {
    // 当前题目
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '题目不存在', 404);
    }
    // 明显过期的请求直接拒绝
    if (dto.version !== question.version) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    // 修改后的题型（未传则保持原值）
    const type = dto.type ?? question.type;
    // 修改后的选项（未传则保持原值）
    const options = dto.options ?? toOptions(question.options);
    // 修改后的答案（未传则保持原值）
    const answer = dto.answer ?? toAnswers(question.answer);
    // 以合并后的完整题目校验规则，避免部分更新产生非法组合
    assertQuestionRules(type, options, answer);

    // 更新字段：只收集显式传入的字段，score 永不写入
    const data: Prisma.QuestionUpdateManyMutationInput = {
      version: { increment: 1 },
      ...(dto.type === undefined ? {} : { type: dto.type }),
      ...(dto.stem === undefined ? {} : { stem: dto.stem }),
      ...(dto.options === undefined
        ? {}
        : { options: dto.options as unknown as Prisma.InputJsonValue }),
      ...(dto.answer === undefined
        ? {}
        : { answer: dto.answer as unknown as Prisma.InputJsonValue }),
      ...(dto.analysis === undefined ? {} : { analysis: dto.analysis }),
    };

    // 条件更新：版本在读取后被他人修改则计数为 0
    const { count } = await this.prisma.question.updateMany({
      where: { id: questionId, version: dto.version },
      data,
    });
    if (count === 0) {
      throw new BizException(
        ErrorCode.IDEMPOTENCY_CONFLICT,
        VERSION_CONFLICT_MESSAGE,
        409,
      );
    }

    await recordAudit(this.audit, context, {
      action: 'question.update',
      targetType: 'question',
      targetId: questionId,
      before: question,
      after: data,
    });

    // 返回更新后的完整题目
    const updated = await this.prisma.question.findUniqueOrThrow({
      where: { id: questionId },
    });
    return toAdminView(updated);
  }

  // 启用题目
  async enable(
    questionId: number,
    context?: AuditContext,
  ): Promise<QuestionAdminView> {
    return this.setStatus(questionId, 'enabled', 'question.enable', context);
  }

  // 停用题目：仅影响后续组卷/考试，已发布快照不受影响
  async disable(
    questionId: number,
    context?: AuditContext,
  ): Promise<QuestionAdminView> {
    return this.setStatus(questionId, 'disabled', 'question.disable', context);
  }

  // 状态流转：校验存在性后更新状态并写审计
  private async setStatus(
    questionId: number, // 题目 id
    status: EnabledStatus, // 目标状态
    action: string, // 审计动作名
    context?: AuditContext, // 管理端上下文
  ): Promise<QuestionAdminView> {
    // 当前题目
    const question = await this.prisma.question.findUnique({
      where: { id: questionId },
    });
    if (!question) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '题目不存在', 404);
    }

    // 更新状态并自增版本
    const updated = await this.prisma.question.update({
      where: { id: questionId },
      data: { status, version: { increment: 1 } },
    });

    await recordAudit(this.audit, context, {
      action,
      targetType: 'question',
      targetId: questionId,
      before: { status: question.status },
      after: { status },
    });

    return toAdminView(updated);
  }
}
