import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';

// 构建被测服务及 Prisma 替身
function setup() {
  const prisma = { auditLog: { create: jest.fn() } };
  const service = new AuditService(prisma as unknown as PrismaService);
  return { prisma, service };
}

describe('AuditService.log', () => {
  it('log 写入 audit_logs 且 before/after 可空', async () => {
    const { prisma, service } = setup();
    prisma.auditLog.create.mockResolvedValue({});

    await service.log({
      actorId: 1,
      action: 'course.publish',
      targetType: 'course',
      targetId: 1,
      before: { status: 'draft' },
      after: { status: 'published' },
      ip: '127.0.0.1',
      requestId: 'req-1',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 1,
        action: 'course.publish',
        targetType: 'course',
        targetId: 1,
        ip: '127.0.0.1',
        requestId: 'req-1',
      }),
    });
  });

  it('before/after 缺省时不写入该字段', async () => {
    const { prisma, service } = setup();
    prisma.auditLog.create.mockResolvedValue({});

    await service.log({
      actorId: 1,
      action: 'chapter.delete',
      targetType: 'chapter',
    });

    const data = prisma.auditLog.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('before');
    expect(data).not.toHaveProperty('after');
  });

  it('Date 等非 JSON 值经序列化后落库', async () => {
    const { prisma, service } = setup();
    prisma.auditLog.create.mockResolvedValue({});

    await service.log({
      actorId: 1,
      action: 'course.update',
      targetType: 'course',
      before: { updatedAt: new Date('2026-01-01T00:00:00.000Z') },
    });

    const data = prisma.auditLog.create.mock.calls[0][0].data;
    expect(data.before).toEqual({ updatedAt: '2026-01-01T00:00:00.000Z' });
  });
});
