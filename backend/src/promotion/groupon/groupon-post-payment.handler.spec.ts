import type { Order, Prisma } from '@prisma/client';
import { GrouponPostPaymentHandler } from './groupon-post-payment.handler';

function setupTx() {
  const tx = {
    grouponMember: { findUnique: jest.fn() },
    grouponGroup: { findUnique: jest.fn(), update: jest.fn() },
    grouponActivity: { findUnique: jest.fn() },
    $queryRaw: jest.fn(),
  };
  tx.$queryRaw.mockResolvedValue([{ id: 20 }]);
  tx.grouponGroup.update.mockResolvedValue({});
  return tx;
}

const ORDER = { id: 10, activityType: 'groupon' } as unknown as Order;

describe('GrouponPostPaymentHandler', () => {
  const handler = new GrouponPostPaymentHandler();

  it('非拼团订单直接跳过', async () => {
    const tx = setupTx();

    await handler.onPaid(
      tx as unknown as Prisma.TransactionClient,
      { id: 10, activityType: 'normal' } as unknown as Order,
    );

    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.grouponMember.findUnique).not.toHaveBeenCalled();
  });

  it('无成员记录的拼团订单防御性跳过', async () => {
    const tx = setupTx();
    tx.grouponMember.findUnique.mockResolvedValue(null);

    await handler.onPaid(tx as unknown as Prisma.TransactionClient, ORDER);

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('支付成功：团组行锁内 memberCount+1，满员成团', async () => {
    const tx = setupTx();
    tx.grouponMember.findUnique.mockResolvedValue({
      groupId: 20,
      activityId: 1,
    });
    tx.grouponGroup.findUnique.mockResolvedValue({
      id: 20,
      status: 'pending',
      memberCount: 1,
    });
    tx.grouponActivity.findUnique.mockResolvedValue({ targetSize: 2 });

    await handler.onPaid(tx as unknown as Prisma.TransactionClient, ORDER);

    const [sqlParts] = tx.$queryRaw.mock.calls[0] as [string[]];
    expect(sqlParts.join('?')).toContain('FOR UPDATE');
    expect(tx.grouponGroup.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: {
        memberCount: 2,
        status: 'success',
        formedAt: expect.any(Date),
      },
    });
  });

  it('未满员仅计团，保持 pending', async () => {
    const tx = setupTx();
    tx.grouponMember.findUnique.mockResolvedValue({
      groupId: 20,
      activityId: 1,
    });
    tx.grouponGroup.findUnique.mockResolvedValue({
      id: 20,
      status: 'pending',
      memberCount: 0,
    });
    tx.grouponActivity.findUnique.mockResolvedValue({ targetSize: 3 });

    await handler.onPaid(tx as unknown as Prisma.TransactionClient, ORDER);

    const updateArgs = tx.grouponGroup.update.mock.calls[0][0] as {
      data: { memberCount: number; status?: string };
    };
    expect(updateArgs.data.memberCount).toBe(1);
    expect(updateArgs.data.status).toBeUndefined();
  });

  it('已成团的团再收到支付拒绝（5001）', async () => {
    const tx = setupTx();
    tx.grouponMember.findUnique.mockResolvedValue({
      groupId: 20,
      activityId: 1,
    });
    tx.grouponGroup.findUnique.mockResolvedValue({
      id: 20,
      status: 'success',
      memberCount: 2,
    });

    await expect(
      handler.onPaid(tx as unknown as Prisma.TransactionClient, ORDER),
    ).rejects.toMatchObject({ bizCode: 5001, status: 422 });
    expect(tx.grouponGroup.update).not.toHaveBeenCalled();
  });
});
