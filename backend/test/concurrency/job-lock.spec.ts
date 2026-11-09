import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { Job, JobsScheduler } from '../../src/jobs/jobs.scheduler';
import { LockService } from '../../src/redis/lock.service';

jest.setTimeout(60000);

describe('Worker 分布式锁（CI 并发）', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('两个调度器实例并发 runOnce，同一任务只执行一次', async () => {
    const lock = app.get(LockService);
    const config = app.get(ConfigService);
    const suffix = Date.now();

    // 持锁时间足够长，确保另一个实例在锁释放前尝试获取
    const run = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return 0;
    });
    const job: Job = { name: `lock-probe-${suffix}`, run };

    const first = new JobsScheduler([job], lock, config);
    const second = new JobsScheduler([job], lock, config);

    await Promise.all([first.runOnce(), second.runOnce()]);

    expect(run).toHaveBeenCalledTimes(1);

    // 执行完成后锁已释放
    const release = await lock.acquire(`job:${job.name}`, 1000);
    expect(release).not.toBeNull();
    await release!();
  });
});
