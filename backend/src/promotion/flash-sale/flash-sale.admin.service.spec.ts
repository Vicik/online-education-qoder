import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FlashSaleAdminService } from './flash-sale.admin.service';

const CTX = { actorId: 9, ip: '127.0.0.1', requestId: 'req-1' };

const START = '2027-01-01T00:00:00Z';
const END = '2027-01-02T00:00:00Z';

const CREATE = {
  courseId: 1,
  name: '限时秒杀',
  priceCents: 5900,
  stock: 10,
  startAt: START,
  endAt: END,
};

const ACTIVITY = {
  id: 1,
  courseId: 1,
  name: '限时秒杀',
  priceCents: 5900,
  stock: 20,
  sold: 0,
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
    flashSaleActivity: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    grouponActivity: { findFirst: jest.fn() },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new FlashSaleAdminService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { prisma, audit, service };
}

describe('FlashSaleAdminService.create', () => {
  it('仅已发布课程；库存必须 ≥ 1', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1, status: 'published' });

    await expect(service.create({ ...CREATE, stock: 0 })).rejects.toMatchObject(
      { bizCode: 1001, status: 422 },
    );
    expect(prisma.flashSaleActivity.create).not.toHaveBeenCalled();
  });

  it('草稿课程拒绝创建（422）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1, status: 'draft' });

    await expect(service.create(CREATE)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
    });
    expect(prisma.flashSaleActivity.create).not.toHaveBeenCalled();
  });

  it('结束时间不晚于开始时间拒绝（422）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1, status: 'published' });

    await expect(
      service.create({ ...CREATE, startAt: END, endAt: START }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
  });

  it('与同课程拼团活动时间重叠被拒（跨类型 1001）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1, status: 'published' });
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);
    prisma.grouponActivity.findFirst.mockResolvedValue({ id: 9 });

    await expect(service.create(CREATE)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
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
    expect(prisma.flashSaleActivity.create).not.toHaveBeenCalled();
  });

  it('与同课程其他秒杀活动时间重叠被拒（1001）', async () => {
    const { prisma, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1, status: 'published' });
    prisma.flashSaleActivity.findFirst.mockResolvedValue({ id: 5 });
    prisma.grouponActivity.findFirst.mockResolvedValue(null);

    await expect(service.create(CREATE)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
    });
    expect(prisma.flashSaleActivity.create).not.toHaveBeenCalled();
  });

  it('创建成功：默认未开始并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.course.findUnique.mockResolvedValue({ id: 1, status: 'published' });
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.create.mockResolvedValue({
      ...ACTIVITY,
      stock: 10,
    });

    const result = await service.create(CREATE, CTX);

    expect(result).toMatchObject({
      id: 1,
      courseName: 'TypeScript 系统入门',
      status: 'not_started',
      stock: 10,
      sold: 0,
      remaining: 10,
      version: 1,
    });
    expect(prisma.flashSaleActivity.create).toHaveBeenCalledWith(
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
        action: 'flash_sale.create',
        targetId: 1,
      }),
    );
  });
});

describe('FlashSaleAdminService.update', () => {
  it('仅未开始可编辑；库存不得小于已售', async () => {
    const { prisma, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue({
      ...ACTIVITY,
      sold: 10,
      version: 1,
    });

    await expect(
      service.update(1, { version: 1, stock: 5 }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
    expect(prisma.flashSaleActivity.updateMany).not.toHaveBeenCalled();
  });

  it('进行中活动不可编辑（422）', async () => {
    const { prisma, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue({
      ...ACTIVITY,
      status: 'ongoing',
    });

    await expect(
      service.update(1, { version: 1, name: '改名' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
    expect(prisma.flashSaleActivity.updateMany).not.toHaveBeenCalled();
  });

  it('版本不一致返回 409', async () => {
    const { prisma, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);

    await expect(
      service.update(1, { version: 2, name: '改名' }),
    ).rejects.toMatchObject({ bizCode: 4004, status: 409 });
    expect(prisma.flashSaleActivity.updateMany).not.toHaveBeenCalled();
  });

  it('未开始活动可编辑：version 自增并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.update(
      1,
      { version: 1, name: '改名', stock: 15 },
      CTX,
    );

    expect(result).toMatchObject({
      name: '改名',
      stock: 15,
      remaining: 15,
      version: 2,
    });
    expect(prisma.flashSaleActivity.updateMany).toHaveBeenCalledWith({
      where: { id: 1, version: 1, status: 'not_started' },
      data: expect.objectContaining({
        name: '改名',
        stock: 15,
        version: { increment: 1 },
      }),
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'flash_sale.update', targetId: 1 }),
    );
  });

  it('条件更新未命中（并发修改）返回 409', async () => {
    const { prisma, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);
    prisma.grouponActivity.findFirst.mockResolvedValue(null);
    prisma.flashSaleActivity.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.update(1, { version: 1, name: '改名' }),
    ).rejects.toMatchObject({ bizCode: 4004, status: 409 });
  });

  it('编辑后与同课程拼团活动重叠被拒（跨类型 1001）', async () => {
    const { prisma, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.flashSaleActivity.findFirst.mockResolvedValue(null);
    prisma.grouponActivity.findFirst.mockResolvedValue({ id: 9 });

    await expect(
      service.update(1, { version: 1, endAt: '2027-01-03T00:00:00Z' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
    expect(prisma.flashSaleActivity.updateMany).not.toHaveBeenCalled();
  });
});

describe('FlashSaleAdminService.cancel', () => {
  it('仅未开始可取消（422）', async () => {
    const { prisma, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue({
      ...ACTIVITY,
      status: 'ongoing',
    });

    await expect(service.cancel(1, { version: 1 })).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
    });
    expect(prisma.flashSaleActivity.updateMany).not.toHaveBeenCalled();
  });

  it('未开始活动可取消并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);
    prisma.flashSaleActivity.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.cancel(1, { version: 1 }, CTX);

    expect(result.status).toBe('cancelled');
    expect(prisma.flashSaleActivity.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'not_started', version: 1 },
      data: { status: 'cancelled', version: { increment: 1 } },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'flash_sale.cancel', targetId: 1 }),
    );
  });

  it('取消时乐观锁冲突返回 409', async () => {
    const { prisma, service } = setup();
    prisma.flashSaleActivity.findUnique.mockResolvedValue(ACTIVITY);

    await expect(service.cancel(1, { version: 2 })).rejects.toMatchObject({
      bizCode: 4004,
      status: 409,
    });
    expect(prisma.flashSaleActivity.updateMany).not.toHaveBeenCalled();
  });
});

describe('FlashSaleAdminService.listAll', () => {
  it('全状态分页并含 sold/stock', async () => {
    const { prisma, service } = setup();
    prisma.flashSaleActivity.findMany.mockResolvedValue([
      { ...ACTIVITY, sold: 3 },
    ]);
    prisma.flashSaleActivity.count.mockResolvedValue(1);

    const page = await service.listAll({ page: 1, pageSize: 20 });

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: 1,
      courseName: 'TypeScript 系统入门',
      stock: 20,
      sold: 3,
      remaining: 17,
    });
  });

  it('按起止时间推导展示状态（取消/已结束保持不变）', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2027-01-05T00:00:00Z'));
    try {
      const { prisma, service } = setup();
      prisma.flashSaleActivity.findMany.mockResolvedValue([
        // 未开始但已过结束时间：展示为已结束
        {
          ...ACTIVITY,
          id: 1,
          status: 'not_started',
          startAt: new Date('2026-12-30T00:00:00Z'),
          endAt: new Date('2026-12-31T00:00:00Z'),
        },
        // 时间区间内：展示为进行中
        {
          ...ACTIVITY,
          id: 2,
          status: 'ongoing',
          startAt: new Date('2027-01-04T00:00:00Z'),
          endAt: new Date('2027-01-06T00:00:00Z'),
        },
        // 未到开始时间：展示为未开始
        {
          ...ACTIVITY,
          id: 3,
          status: 'not_started',
          startAt: new Date('2027-01-06T00:00:00Z'),
          endAt: new Date('2027-01-07T00:00:00Z'),
        },
        // 已取消：即使已过结束时间仍展示为已取消
        {
          ...ACTIVITY,
          id: 4,
          status: 'cancelled',
          startAt: new Date('2026-12-30T00:00:00Z'),
          endAt: new Date('2026-12-31T00:00:00Z'),
        },
        // 物化状态滞后（进行中但已过结束时间）：展示为已结束
        {
          ...ACTIVITY,
          id: 5,
          status: 'ongoing',
          startAt: new Date('2026-12-30T00:00:00Z'),
          endAt: new Date('2026-12-31T00:00:00Z'),
        },
      ]);
      prisma.flashSaleActivity.count.mockResolvedValue(5);

      const page = await service.listAll({ page: 1, pageSize: 20 });

      expect(page.items.map((item) => item.status)).toEqual([
        'ended',
        'ongoing',
        'not_started',
        'cancelled',
        'ended',
      ]);
    } finally {
      jest.useRealTimers();
    }
  });
});
