import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CouponAdminService } from './coupon.admin.service';

const CTX = { actorId: 9, ip: '127.0.0.1', requestId: 'req-1' };

const TEMPLATE = {
  id: 1,
  name: '新学员券',
  discountCents: 2000,
  startAt: new Date('2026-01-01T00:00:00Z'),
  endAt: new Date('2026-02-01T00:00:00Z'),
  totalQty: 100,
  claimedCount: 0,
  status: 'disabled',
  version: 3,
  courses: [{ courseId: 1 }],
};

const CREATE = {
  name: '新学员券',
  discountCents: 2000,
  startAt: '2026-01-01T00:00:00Z',
  endAt: '2026-02-01T00:00:00Z',
  totalQty: 100,
  perUserLimit: 5,
  courseIds: [1],
};

function setup() {
  const prisma = {
    couponTemplate: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    couponTemplateCourse: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    couponClaim: {
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    course: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (fn: (tx: typeof prisma) => unknown) => fn(prisma),
  );
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new CouponAdminService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { prisma, audit, service };
}

describe('CouponAdminService.create', () => {
  it('时间非法返回 1001', async () => {
    const { service } = setup();

    await expect(
      service.create({
        ...CREATE,
        startAt: '2026-01-02T00:00:00Z',
        endAt: '2026-01-01T00:00:00Z',
      }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('面额或总量非法返回 1001', async () => {
    const { service } = setup();

    await expect(
      service.create({ ...CREATE, discountCents: 0 }),
    ).rejects.toMatchObject({ bizCode: 1001 });

    await expect(
      service.create({ ...CREATE, totalQty: 0 }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('未关联课程返回 1001', async () => {
    const { service } = setup();

    await expect(
      service.create({ ...CREATE, courseIds: [] }),
    ).rejects.toMatchObject({ bizCode: 1001 });
  });

  it('关联课程必须全部已发布', async () => {
    const { prisma, service } = setup();
    prisma.course.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await expect(
      service.create({ ...CREATE, courseIds: [1, 2, 3] }),
    ).rejects.toMatchObject({ bizCode: 1001 });
    expect(prisma.couponTemplate.create).not.toHaveBeenCalled();
  });

  it('免费课程不可关联优惠券（422/1001）', async () => {
    const { prisma, service } = setup();
    prisma.course.findMany.mockResolvedValue([{ id: 1, saleCents: 0 }]);

    await expect(service.create(CREATE)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
      message: '免费课程不可关联优惠券',
    });
  });

  it('默认停用；perUserLimit 强制为 1；关联课程与审计同事务写入', async () => {
    const { prisma, audit, service } = setup();
    prisma.course.findMany.mockResolvedValue([{ id: 1 }]);
    prisma.couponTemplate.create.mockResolvedValue({
      ...TEMPLATE,
      version: 1,
      courses: undefined,
    });

    const result = await service.create(CREATE, CTX);

    expect(result.status).toBe('disabled');
    expect(result.courseIds).toEqual([1]);
    expect(prisma.couponTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'disabled',
          perUserLimit: 1,
        }),
      }),
    );
    expect(prisma.couponTemplateCourse.createMany).toHaveBeenCalledWith({
      data: [{ templateId: 1, courseId: 1 }],
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'coupon.create', targetId: 1 }),
    );
  });

  it('enableOnCreate 时创建即启用', async () => {
    const { prisma, service } = setup();
    prisma.course.findMany.mockResolvedValue([{ id: 1 }]);
    prisma.couponTemplate.create.mockResolvedValue({
      ...TEMPLATE,
      status: 'enabled',
      courses: undefined,
    });

    const result = await service.create(
      { ...CREATE, enableOnCreate: true },
      CTX,
    );

    expect(result.status).toBe('enabled');
    expect(prisma.couponTemplate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'enabled' }),
      }),
    );
  });
});

describe('CouponAdminService.update', () => {
  it('启用态只读返回 1001（422）', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue({
      ...TEMPLATE,
      status: 'enabled',
    });

    await expect(
      service.update(1, { version: 3, name: '改名' }),
    ).rejects.toMatchObject({ bizCode: 1001, status: 422 });
    expect(prisma.couponTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('版本冲突返回 409', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue(TEMPLATE);

    await expect(
      service.update(1, { version: 2, name: '改名' }),
    ).rejects.toMatchObject({ bizCode: 4004, status: 409 });
    expect(prisma.couponTemplate.updateMany).not.toHaveBeenCalled();
  });

  it('停用态可改全部字段，课程关联重设且 perUserLimit 恒为 1', async () => {
    const { prisma, audit, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue(TEMPLATE);
    prisma.couponTemplate.updateMany.mockResolvedValue({ count: 1 });
    prisma.course.findMany.mockResolvedValue([{ id: 2 }]);

    const result = await service.update(
      1,
      { version: 3, name: '改名', discountCents: 3000, courseIds: [2] },
      CTX,
    );

    expect(result).toMatchObject({
      name: '改名',
      discountCents: 3000,
      courseIds: [2],
      version: 4,
    });
    expect(prisma.couponTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: 1, version: 3, status: 'disabled' },
      data: expect.objectContaining({
        name: '改名',
        discountCents: 3000,
        perUserLimit: 1,
        version: { increment: 1 },
      }),
    });
    expect(prisma.couponTemplateCourse.deleteMany).toHaveBeenCalledWith({
      where: { templateId: 1 },
    });
    expect(prisma.couponTemplateCourse.createMany).toHaveBeenCalledWith({
      data: [{ templateId: 1, courseId: 2 }],
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'coupon.update', targetId: 1 }),
    );
  });
});

describe('CouponAdminService.enable', () => {
  it('停用 → 启用并写审计', async () => {
    const { prisma, audit, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue(TEMPLATE);
    prisma.couponTemplate.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.enable(1, CTX);

    expect(result.status).toBe('enabled');
    expect(prisma.couponTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: 'disabled' },
      data: { status: 'enabled', version: { increment: 1 } },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'coupon.enable', targetId: 1 }),
    );
  });

  it('已启用再启用返回 422', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue({
      ...TEMPLATE,
      status: 'enabled',
    });

    await expect(service.enable(1, CTX)).rejects.toMatchObject({
      bizCode: 1001,
      status: 422,
    });
  });
});

describe('CouponAdminService.disable', () => {
  it('级联：unused/restored → invalid 且 claimKey 置 NULL；used 保留', async () => {
    const { prisma, audit, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue({
      ...TEMPLATE,
      status: 'enabled',
      claimedCount: 5,
    });
    prisma.couponTemplate.updateMany.mockResolvedValue({ count: 1 });
    prisma.couponClaim.updateMany.mockResolvedValue({ count: 2 });

    const result = await service.disable(1, { version: 3 }, CTX);

    expect(result).toMatchObject({ status: 'disabled', claimedCount: 3 });
    expect(prisma.couponClaim.updateMany).toHaveBeenCalledWith({
      where: { templateId: 1, status: { in: ['unused', 'restored'] } },
      data: { status: 'invalid', claimKey: null },
    });
    expect(prisma.couponTemplate.updateMany).toHaveBeenLastCalledWith({
      where: { id: 1 },
      data: { claimedCount: { decrement: 2 } },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'coupon.disable', targetId: 1 }),
    );
  });

  it('已停用再停用返回 422', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue(TEMPLATE);

    await expect(service.disable(1, { version: 3 }, CTX)).rejects.toMatchObject(
      { bizCode: 1001, status: 422 },
    );
  });

  it('version 不匹配返回 409', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue({
      ...TEMPLATE,
      status: 'enabled',
    });

    await expect(service.disable(1, { version: 1 }, CTX)).rejects.toMatchObject(
      { bizCode: 4004, status: 409 },
    );
  });
});

describe('CouponAdminService 查询', () => {
  it('详情不存在返回 404', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findUnique.mockResolvedValue(null);

    await expect(service.getDetail(1)).rejects.toMatchObject({
      bizCode: 1002,
      status: 404,
    });
  });

  it('列表按状态筛选并映射 courseIds', async () => {
    const { prisma, service } = setup();
    prisma.couponTemplate.findMany.mockResolvedValue([TEMPLATE]);
    prisma.couponTemplate.count.mockResolvedValue(1);

    const page = await service.list({ page: 1, pageSize: 20 }, 'disabled');

    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ id: 1, courseIds: [1] });
    expect(prisma.couponTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'disabled' } }),
    );
  });
});
