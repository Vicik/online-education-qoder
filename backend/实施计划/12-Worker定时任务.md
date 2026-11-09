# 步骤 12：Worker 定时任务

> 总览：[实施计划 README](./README.md) · 前置：步骤 06、07、08、09、10 · 后继：步骤 14

**目标**：实现独立 Worker 进程（`worker.ts`，无 HTTP），按 D4「DB 定时扫描」执行六个定时任务（目录结构.md §4），全部幂等（扫描条件 + 状态机保证），Redis 分布式锁保证多实例下同一任务单实例执行。

**完成标准**：
- [ ] `npm run worker` 独立进程启动；六个任务按 `JOB_SCAN_INTERVAL_SECONDS`（默认 60s）周期扫描
- [ ] 拼团到期：团 `failed` + 成员订单退款 + 券恢复（单事务，复用步骤 08 `failExpiredGroups`）
- [ ] 订单超时：`pending` 超时 → `cancelled` + 释放秒杀预占 + 恢复券 + purchaseKey 置空
- [ ] 券过期标记、活动状态流转（not_started→ongoing→ended）、考试兜底交卷、秒杀库存预热
- [ ] 分布式锁：并发 Worker 实例同一任务只执行一次（CI 并发测试）
- [ ] 本机单元测试全过；CI 集成测试全绿

## 文件清单

- Create：`src/worker.ts`（入口：`NestFactory.createApplicationContext(AppModule)` + 启动调度器）
- Create：`src/jobs/jobs.module.ts`、`jobs.scheduler.ts`（扫描循环 + 锁包装）
- Create：`src/jobs/groupon-expiry.job.ts`、`order-timeout.job.ts`、`coupon-expiry.job.ts`、`activity-status.job.ts`、`exam-auto-submit.job.ts`、`flash-stock-warmup.job.ts`
- Modify：`src/app.module.ts`（注册 JobsModule，仅 Worker 入口 import）、`src/trade/order/order.service.ts`（补 `cancelExpiredOrders(now)`）、`src/promotion/flash-sale/flash-stock.service.ts`（已有 warmup）
- Test：`src/jobs/*.spec.ts`（单测 fake 时间）、`test/integration/jobs.spec.ts`、`test/concurrency/job-lock.spec.ts`（CI）

## 接口契约

**Consumes**：步骤 01 的 `LockService`；步骤 06 的 `CouponUserService.restoreInTx`；步骤 07 的 `PaymentGateway.refund`；步骤 08 的 `GrouponUserService.failExpiredGroups(now)`；步骤 09 的 `FlashStockService.warmup/restore`；步骤 10 的 `ExamUserService.autoSubmitExpired(now)`。

**Produces**：无外部接口；仅运维可见（日志结构化输出每次扫描处理数）。

## 任务 1：调度器与锁

- [ ] **1.1 写失败测试** `src/jobs/jobs.scheduler.spec.ts`

```ts
it('每周期依次执行六个任务；任务抛错不中断后续任务', async () => {
  const tasks = [jest.fn().mockResolvedValue(0), jest.fn().mockRejectedValue(new Error('boom')), jest.fn()];
  const scheduler = new JobsScheduler(tasks as any, lock, 60);
  await scheduler.runOnce();
  expect(tasks[0]).toHaveBeenCalled();
  expect(tasks[2]).toHaveBeenCalled();                    // 前一个抛错不影响后续
});
it('锁被占用时本轮全部跳过', async () => {
  lock.acquire.mockResolvedValue(null);
  await scheduler.runOnce();
  expect(tasks[0]).not.toHaveBeenCalled();
});
it('任务完成后释放锁', async () => { /* release 被调 */ });
```

- [ ] **1.2 运行确认失败**；**1.3 实现**

```ts
// jobs.scheduler.ts
@Injectable()
export class JobsScheduler implements OnModuleInit {
  constructor(private readonly jobs: Job[], @Inject('JOB_LOCK') private readonly lock: LockService,
              private readonly cfg: AppConfig) {}
  onModuleInit() {
    setInterval(() => this.runOnce(), this.cfg.jobScanIntervalSeconds * 1000);
    void this.runOnce();                                  // 启动立即跑一轮
  }
  async runOnce() {
    for (const job of this.jobs) {
      const release = await this.lock.acquire(`job:${job.name}`, 120_000);
      if (!release) { this.log(`跳过：${job.name} 锁被占用`); continue; }
      try {
        const n = await job.run(new Date());
        if (n > 0) this.log(`${job.name} 处理 ${n} 条`);
      } catch (e) { this.log(`${job.name} 失败`, e); }
      finally { await release(); }
    }
  }
}
export interface Job { readonly name: string; run(now: Date): Promise<number>; }
```

`JobsModule`：`@Global()` 提供 `JOB_LOCK`（LockService），六个 Job 以 `useClass + multi` 注册为 `Job[]`。`worker.ts`：`createApplicationContext(AppModule)` + `app.get(JobsScheduler)`（OnModuleInit 自动启动）；**不 `listen`**。

- [ ] **1.4 运行确认通过**；**1.5 提交** `git commit -m "feat(jobs): worker scheduler with per-job distributed lock"`

## 任务 2：拼团到期 + 订单超时

- [ ] **2.1 写失败测试** `src/jobs/groupon-expiry.job.spec.ts`、`order-timeout.job.spec.ts`

```ts
it('groupon-expiry 调用 failExpiredGroups(now) 并返回处理数', async () => {
  grouponService.failExpiredGroups.mockResolvedValue(3);
  await expect(job.run(new Date())).resolves.toBe(3);
});
it('order-timeout：pending 且 expiresAt<now → cancelled + 券恢复 + 秒杀预占回补 + purchaseKey 置空', async () => {
  orderService.cancelExpiredOrders.mockResolvedValue(2);
  await expect(job.run(now)).resolves.toBe(2);
});
```

- [ ] **2.2 运行确认失败**；**2.3 实现**

- `groupon-expiry.job.ts`：一行代理 `this.groupons.failExpiredGroups(now)`（业务逻辑在步骤 08，已幂等）。
- `order-timeout.job.ts` → `OrderService.cancelExpiredOrders(now)`（在 trade 模块补此方法）：

```ts
async cancelExpiredOrders(now: Date): Promise<number> {
  const expired = await this.prisma.order.findMany({
    where: { status: 'pending', expiresAt: { lt: now } } });
  let n = 0;
  for (const o of expired) {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: o.id, status: 'pending' },          // 状态条件防并发重复处理
        data: { status: 'cancelled', purchaseKey: null, flashPurchaseKey: null } });
      if (count === 0) return;
      if (o.activityType === 'flash_sale' && o.activityId)
        await this.flashStock.restore(o.activityId);     // 回补预占（§9.4）
      if (o.couponClaimId)
        await tx.couponClaim.updateMany({ where: { id: o.couponClaimId, status: 'used' },
          data: { status: 'restored' } });               // 券恢复（used→restored）
      n++;
    });
  }
  return n;
}
```

> `FlashStockService` 注入 trade 会引入 promotion→trade 反向依赖？不——`flashStock.restore` 只碰 Redis，将「回补」动作抽象为回调注入：`OrderService` 构造器接收可选 `@Inject('FLASH_STOCK_RESTORE') restoreFn: (activityId: number) => Promise<void>`，由 PromotionModule 提供实现（`useFactory` 指向 FlashStockService）。避免模块环依赖。

- [ ] **2.4 运行确认通过**；**2.5 提交** `git commit -m "feat(jobs): groupon expiry and order timeout cancellation with resource release"`

## 任务 3：券过期 + 活动状态流转 + 考试兜底 + 秒杀预热

- [ ] **3.1 写失败测试**（四个 job 各一组）

```ts
it('coupon-expiry：unused/restored 且模板 endAt<now → expired（幂等：只处理未失效）', async () => {
  prisma.couponClaim.updateMany.mockResolvedValue({ count: 2 });
  await expect(job.run(now)).resolves.toBe(2);
  expect(prisma.couponClaim.updateMany).toHaveBeenCalledWith({ where: expect.objectContaining({
    status: { in: ['unused', 'restored'] } }), data: { status: 'expired' } });
});
it('activity-status：按时间推进 not_started→ongoing→ended（拼团与秒杀）', async () => {
  prisma.grouponActivity.updateMany.mockResolvedValue({ count: 1 });
  prisma.flashSaleActivity.updateMany.mockResolvedValue({ count: 1 });
  await job.run(now);
  // 断言四个 updateMany：两表 ×（开播、结束）
});
it('exam-auto-submit 代理 autoSubmitExpired(now)', async () => { /* 返回处理数 */ });
it('flash-warmup：活动进入 ongoing 时 SET 剩余=stock-sold（幂等）', async () => {
  prisma.flashSaleActivity.updateMany.mockResolvedValue({ count: 1 });
  prisma.flashSaleActivity.findMany.mockResolvedValue([{ id: 5, stock: 50, sold: 2 }]);
  stock.warmup.mockResolvedValue(undefined);
  await expect(job.run(now)).resolves.toBe(1);
  expect(stock.warmup).toHaveBeenCalledWith(5, 48);
});
```

- [ ] **3.2 运行确认失败**；**3.3 实现**

- `coupon-expiry.job.ts`：`updateMany({ where: { status: { in: ['unused','restored'] }, template: { endAt: { lt: now } } }, data: { status: 'expired' } })`（`claimKey` 保留——已过期仍阻止再领，§9.3 已决语义）。
- `activity-status.job.ts`：四个条件更新——groupon `not_started + startAt≤now → ongoing`、`ongoing + endAt<now → ended`；flash_sale 同构。返回四者计数之和。
- `exam-auto-submit.job.ts`：代理 `examService.autoSubmitExpired(now)`（步骤 10 已实现：deadline 已过未提交 → 按空答案判分交卷）。
- `flash-stock-warmup.job.ts`：先执行「未开始→进行中」流转，再对刚进入 ongoing 的活动（`startAt ≤ now < endAt`）逐个 `warmup(id, stock - sold)`；warmup 用 `SET` 覆盖即幂等（重复预热无害）。

- [ ] **3.4 运行确认通过**；**3.5 提交** `git commit -m "feat(jobs): coupon expiry, activity status flow, exam auto-submit and flash warmup"`

## 任务 4：集成与并发测试（CI）

- [ ] **4.1 写 `test/integration/jobs.spec.ts`**

```ts
describe('Worker 任务（CI 集成）', () => {
  it('拼团到期：pending 团过期 → failed + 订单 refunded + 券 restored + 退款台账', async () => {
    // 准备：活动 endAt=过去 → 团 pending 过期 → 直接调 GrouponUserService.failExpiredGroups
    const n = await app.get(GrouponUserService).failExpiredGroups(new Date());
    expect(n).toBeGreaterThanOrEqual(1);
    const g = await prisma.grouponGroup.findUnique({ where: { id: expiredGroupId } });
    expect(g!.status).toBe('failed');
    const o = await prisma.order.findUnique({ where: { id: memberOrderId } });
    expect(o!.status).toBe('refunded');
    expect(o!.purchaseKey).toBeNull();                       // 可再购
    const refund = await prisma.payment.findFirst({ where: { orderId: o!.id, status: 'refunded' } });
    expect(refund).toBeTruthy();
  });
  it('订单超时取消：pending 过期 → cancelled + 券 restored + 秒杀预占回补', async () => {
    // 构造 pending 过期订单（秒杀 + 用券）→ cancelExpiredOrders
    const n = await app.get(OrderService).cancelExpiredOrders(new Date());
    expect(n).toBeGreaterThanOrEqual(1);
    // 断言 cancelled、claim restored、Redis 计数 +1
  });
  it('考试兜底交卷：deadline 已过未提交 → 自动判分（空答案 0 分）', async () => {
    const n = await app.get(ExamUserService).autoSubmitExpired(new Date());
    const attempt = await prisma.examAttempt.findUnique({ where: { id: expiredAttemptId } });
    expect(attempt!.submittedAt).not.toBeNull();
    expect(attempt!.score).toBe(0);
  });
});
```

- [ ] **4.2 写 `test/concurrency/job-lock.spec.ts`**（CI）

```ts
describe('Worker 分布式锁（CI 并发）', () => {
  it('两个调度器实例并发 runOnce，任务只执行一次', async () => {
    // 构造两个 JobsScheduler（同一 Redis）→ 并发 runOnce → 每个 job 的执行次数断言
    const results = await Promise.all([s1.runOnce(), s2.runOnce()]);
    // 通过审计日志或 spy 计数：任一任务实际执行（获锁）次数 ≤1
  });
});
```

- [ ] **4.3 CI 运行确认通过** — Expected: 全绿。
- [ ] **4.4 提交** `git commit -m "test(jobs): expiry flows integration and distributed lock concurrency"`

## 完成标准复核

- [ ] 本机：`npm test` 全过（六个 job 均有单测）
- [ ] CI：三个到期链路（拼团退款/订单取消/考试兜底）数据状态断言全绿；锁并发用例绿
- [ ] Worker 与 API 进程分离（`worker.ts` 不监听端口）；任务日志含处理数与耗时
- [ ] 全部任务幂等（重复运行数据不变）；锁 TTL 120s > 单任务最坏耗时
