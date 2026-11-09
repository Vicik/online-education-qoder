import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { GrouponAdminService } from './groupon.admin.service';

const CTX = { actorId: 9, ip: '127.0.0.1', requestId: 'req-1' };

const START = '2027-01-01T00:00:00Z';
const END = '2027-01-02T00:00:00Z';

const CREATE = {
  courseId: 1,
  name: '双人成团特惠',
  priceCents: 6900,
  targetSize: 2,
  startAt: START,
  endAt: END,
};

const ACTIVITY = {
  id: 1,
  courseId: 1,
  name: '双人成团特惠',
  priceCents: 6900,
  targetSize: 2,
  startAt: new Date(START),
  endAt: new Date(END),
  status: 'not_started',
  version: 1,
  createdAt: new Date(START),
  updatedAt: new Date(START),
  course: { name: 'TypeScript 系统入门' },
};

function setup() {
  const prisma = {
    course: { findUnique: jest.fn() },
    grouponActivity: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    flashSaleActivity: { findFirst: jest.fn() },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new GrouponAdminService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { prisma, audit, service };
}

describe('GrouponAdminService.create', () => {
  it('草稿课程拒绝创建（422）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1, status: 'draft' });

    await expect(service.create(CREATE)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
    });
    expect(prisma.grouponActivity.create).not.toHaveBeenCalled();
  });

  it('结束时间不晚于开始时间拒绝（422）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1, status: 'published' });

    await expect(
      service.create({ ...CREATE, startAt: END, endAt: START }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
  });

  it('同课程时间重叠被拒（1001）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1, status: 'published' });
    prisma.grouponActivity.findFirst.mockResolvedValue({ id: 99 });

    await expect(service.create(CREATE)).rejects.toMatchObject({
      bizCode: 1001,
    });
    expect(prisma.grouponActivity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          courseId: 1,
          status: { not: 'cancelled' },
          startAt: { lt: new Date(END) },
          endAt: { gt: new Date(START) },
        }),
      }),
    );
    expect(prisma.grouponActivity.create).not.toHaveBeenCalled();
  });

  it('与同课程秒杀活动时间重叠被拒（跨类型 1001）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1, status: 'published' });
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.findFirst.mockResolvedValue({ id: 7 });

    await expect(service.create(CREATE)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
    });
    expect(prisma.flashSaleActivity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          courseId: 1,
          status: { not: 'cancelled' },
          startAt: { lt: new Date(END) },
          endAt: { gt: new Date(START) },
        }),
      }),
    );
    expect(prisma.grouponActivity.create).not.toHaveBeenCalled();
  });

  it('创建成功：默认未开始并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1, status: 'published' });
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);
    prisma.grouponActivity.create.mockResolvedValue(ACTIVITY);

    const result = await service.create(CREATE, CTX);

    expect(result).toMatchObject({
      id: 1,
      courseName: 'TypeScript 系统入门',
      status: 'not_started',
      targetSize: 2,
    });
    expect(prisma.grouponActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          courseId: 1,
          status: 'not_started',
          startAt: new Date(START),
          endAt: new Date(END),
        }),
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'groupon.create',
        targetId: 1,
      }),
    );
  });
});

describe('GrouponAdminService.update', () => {
  it('进行中活动不可编辑（422）', async () => {
    const { prisma, service } = setup();
    prisma.grouponActivity.findUnique.mockResolvedValue({
      ...ACTIVITY,
      status: 'ongoing',
    });

    await expect(
      service.update(1, { version: 1, name: '改名' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
    expect(prisma.grouponActivity.updateMany).not.toHaveBeenCalled();
  });

  it('版本不一致返回 409', async () => {
    const { prisma, service } = setup();
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);

    await expect(
      service.update(1, { version: 2, name: '改名' }),
    ).rejects.toMatchObject({ bizCode: 4004, status: 409 });
    expect(prisma.grouponActivity.updateMany).not.toHaveBeenCalled();
  });

  it('未开始活动可编辑：version 自增并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);
    prisma.grouponActivity.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.update(
      1,
      { version: 1, name: '改名', priceCents: 5900 },
      CTX,
    );

    expect(result).toMatchObject({
      name: '改名',
      priceCents: 5900,
      version: 2,
    });
    expect(prisma.grouponActivity.updateMany).toHaveBeenCalledWith({
      where: { id: 1, version: 1, status: 'not_started' },
      data: expect.objectContaining({
        name: '改名',
        priceCents: 5900,
        version: { increment: 1 },
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'groupon.update', targetId: 1 }),
    );
  });

  it('编辑后与其他活动重叠被拒（1001）', async () => {
    const { prisma, service } = setup();
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.grouponActivity.findFirst.mockResolvedValue({ id: 99 });

    await expect(
      service.update(1, { version: 1, endAt: '2027-01-03T00:00:00Z' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
    expect(prisma.grouponActivity.updateMany).not.toHaveBeenCalled();
  });
  it('编辑后与同课程秒杀活动重叠被拒（跨类型 1001）', async () => {
    const { prisma, service } = setup();
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.findFirst.mockResolvedValue({ id: 7 });

    await expect(
      service.update(1, { version: 1, endAt: '2027-01-03T00:00:00Z' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
    expect(prisma.grouponActivity.updateMany).not.toHaveBeenCalled();
  });
});

describe('GrouponAdminService.cancel', () => {
  it('进行中活动不可取消（422）', async () => {
    const { prisma, service } = setup();
    prisma.grouponActivity.findUnique.mockResolvedValue({
      ...ACTIVITY,
      status: 'ongoing',
    });

    await expect(service.cancel(1, { version: 1 })).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
    });
    expect(prisma.grouponActivity.updateMany).not.toHaveBeenCalled();
  });

  it('未开始活动可取消并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.grouponActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.grouponActivity.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.cancel(1, { version: 1 }, CTX);

    expect(result.status).toBe('cancelled');
    expect(prisma.grouponActivity.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'not_started', version: 1 },
      data: { status: 'cancelled', version: { increment: 1 } },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'groupon.cancel', targetId: 1 }),
    );
  });
});

describe('GrouponAdminService.listAll', () => {
  it('全状态分页并带课程名', async () => {
    const { prisma, service } = setup();
    prisma.grouponActivity.findMany.mockResolvedValue([ACTIVITY]);
    prisma.grouponActivity.count.mockResolvedValue(1);

    const page = await service.listAll({ page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: 1,
      courseName: 'TypeScript 系统入门',
    });
  });
});
