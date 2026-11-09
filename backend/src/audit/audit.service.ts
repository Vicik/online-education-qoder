import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// 审计日志写入参数：与 audit_logs 表字段对应
export interface AuditLogInput {
  actorId: number; // 操作人用户 id
  action: string; // 动作名，如 course.publish
  targetType: string; // 目标类型，如 course
  targetId?: number; // 目标 id
  before?: unknown; // 变更前快照
  after?: unknown; // 变更后快照
  ip?: string; // 客户端 IP
  requestId?: string; // 请求追踪 id
}

// 管理端写操作上下文：由 controller 从会话与请求中提取
export interface AuditContext {
  actorId: number; // 操作人用户 id
  ip?: string; // 客户端 IP
  requestId?: string; // 请求追踪 id
}

// 业务动作参数：不含操作人与请求信息
export type AuditAction = Omit<AuditLogInput, 'actorId' | 'ip' | 'requestId'>;

// 将任意值转换为 Prisma JSON 可写入值：去掉 undefined、日期转 ISO 字符串
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  // 空值不写入，避免生成 before: null 的无意义字段
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// 审计服务：管理端写操作留痕
@Injectable()
export class AuditService {
  // 构造函数：注入 Prisma 服务
  constructor(private readonly prisma: PrismaService) {}

  // 写入一条审计日志
  async log(input: AuditLogInput): Promise<void> {
    // 变更前后快照：统一序列化为 JSON
    const before = toJson(input.before);
    const after = toJson(input.after);

    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        targetType: input.targetType,
        ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
        ...(input.ip === undefined ? {} : { ip: input.ip }),
        ...(input.requestId === undefined
          ? {}
          : { requestId: input.requestId }),
      },
    });
  }
}

// 写入审计：无管理端上下文（如单元测试直接调用服务）时跳过，避免产生无操作人的记录
export async function recordAudit(
  audit: AuditService,
  context: AuditContext | undefined,
  action: AuditAction,
): Promise<void> {
  // 缺少上下文时视为非 HTTP 调用，不写审计
  if (!context) return;
  await audit.log({
    ...action,
    actorId: context.actorId,
    ip: context.ip,
    requestId: context.requestId,
  });
}
