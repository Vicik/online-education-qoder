import { Injectable } from '@nestjs/common';
import { BlockedWord, EnabledStatus } from '@prisma/client';
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
import { UpdateBlockedWordDto } from '../dto/create-blocked-word.dto';

// 屏蔽词视图：管理端列表/创建返回结构（与 openapi BlockedWord 一致）
export type BlockedWordView = Pick<BlockedWord, 'id' | 'word' | 'status'>;

// 屏蔽词查询字段：对外只暴露 id/word/status
const BLOCKED_WORD_SELECT = { id: true, word: true, status: true } as const;

// 判断错误是否为唯一约束冲突（P2002）
function isUniqueConflict(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === 'P2002';
}

// 屏蔽词服务：内容校验（包含匹配 + 忽略英文大小写）与管理端 CRUD
@Injectable()
export class BlockedWordService {
  // 构造函数：注入 Prisma 服务与审计服务
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // 校验文本：包含匹配 + 忽略英文大小写；每次实时查库，管理端修改立即生效
  async assertAllowed(content: string): Promise<void> {
    // 仅启用状态的词参与匹配（查询已过滤；再兜底一次防御异常数据）
    const words = await this.prisma.blockedWord.findMany({
      where: { status: 'enabled' },
    });
    // 统一转小写做包含匹配
    const lower = content.toLowerCase();
    // 收集全部命中词（保持配置顺序，跳过明确停用的行）
    const hits = words
      .filter((item) => item.status !== 'disabled')
      .filter((item) => lower.includes(item.word.toLowerCase()))
      .map((item) => item.word);
    // 命中即阻止提交，422 + code=7001，details 附完整词表
    if (hits.length > 0) {
      throw new BizException(
        ErrorCode.BLOCKED_WORD,
        '内容包含敏感词，请修改后重新提交',
        422,
        hits,
      );
    }
  }

  // 管理端列表：按状态过滤（可选）+ 创建时间倒序分页
  async list(
    status: EnabledStatus | undefined,
    page: PageQuery,
  ): Promise<PageResult<BlockedWordView>> {
    // 分页参数兜底
    const pageNo = page.page ?? 1;
    const pageSize = page.pageSize ?? 20;
    // 查询条件：未指定状态时返回全部
    const where = status === undefined ? {} : { status };

    const [items, total] = await Promise.all([
      this.prisma.blockedWord.findMany({
        where,
        select: BLOCKED_WORD_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (pageNo - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.blockedWord.count({ where }),
    ]);

    return { items, total, page: pageNo, pageSize };
  }

  // 新增屏蔽词：词唯一，重复抛 1001/409，并写审计
  async create(word: string, context?: AuditContext): Promise<BlockedWordView> {
    // 去除首尾空白，空词视为参数错误
    const normalized = word.trim();
    if (normalized.length === 0) {
      throw new BizException(ErrorCode.PARAM_INVALID, '屏蔽词不能为空', 400);
    }

    let created: BlockedWordView;
    try {
      created = await this.prisma.blockedWord.create({
        data: { word: normalized },
        select: BLOCKED_WORD_SELECT,
      });
    } catch (error) {
      // 唯一约束冲突：该词已存在
      if (isUniqueConflict(error)) {
        throw new BizException(ErrorCode.PARAM_INVALID, '屏蔽词已存在', 409);
      }
      throw error;
    }

    // 审计：新增屏蔽词
    await recordAudit(this.audit, context, {
      action: 'blocked_word.create',
      targetType: 'blocked_word',
      targetId: created.id,
      after: created,
    });
    return created;
  }

  // 修改屏蔽词：可改词文本或启停状态，写对应审计
  async update(
    id: number,
    dto: UpdateBlockedWordDto,
    context?: AuditContext,
  ): Promise<void> {
    // 词必须存在
    const existing = await this.prisma.blockedWord.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '屏蔽词不存在', 404);
    }

    // 组装待更新字段
    const data: { word?: string; status?: EnabledStatus } = {};
    if (dto.word !== undefined) {
      // 改词时同样去除空白并拒绝空词
      const normalized = dto.word.trim();
      if (normalized.length === 0) {
        throw new BizException(ErrorCode.PARAM_INVALID, '屏蔽词不能为空', 400);
      }
      data.word = normalized;
    }
    if (dto.status !== undefined) data.status = dto.status;
    // 无任何修改时直接返回（幂等）
    if (Object.keys(data).length === 0) return;

    let updated: BlockedWordView;
    try {
      updated = await this.prisma.blockedWord.update({
        where: { id },
        data,
        select: BLOCKED_WORD_SELECT,
      });
    } catch (error) {
      // 改词后与其他词重复
      if (isUniqueConflict(error)) {
        throw new BizException(ErrorCode.PARAM_INVALID, '屏蔽词已存在', 409);
      }
      throw error;
    }

    // 状态切换记 enable/disable，仅改词文本记 update
    const action =
      dto.status !== undefined && dto.status !== existing.status
        ? `blocked_word.${dto.status === 'enabled' ? 'enable' : 'disable'}`
        : 'blocked_word.update';

    // 审计：修改前后快照
    await recordAudit(this.audit, context, {
      action,
      targetType: 'blocked_word',
      targetId: id,
      before: { id: existing.id, word: existing.word, status: existing.status },
      after: updated,
    });
  }

  // 删除屏蔽词：不存在抛 404，并写审计
  async remove(id: number, context?: AuditContext): Promise<void> {
    // 词必须存在
    const existing = await this.prisma.blockedWord.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '屏蔽词不存在', 404);
    }

    await this.prisma.blockedWord.delete({ where: { id } });

    // 审计：删除前快照
    await recordAudit(this.audit, context, {
      action: 'blocked_word.delete',
      targetType: 'blocked_word',
      targetId: id,
      before: { id: existing.id, word: existing.word, status: existing.status },
    });
  }
}
