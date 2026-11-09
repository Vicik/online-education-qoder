import type { ConfigService } from '@nestjs/config';
import type { LockService } from '../redis/lock.service';
import { JOB_LOCK_TTL_MS, Job, JobsScheduler } from './jobs.scheduler';

type TestJob = Job & { run: jest.Mock };

function job(
  name: string,
  run: jest.Mock = jest.fn().mockResolvedValue(0),
): TestJob {
  return { name, run } as TestJob;
}

function setup(jobs: Job[]) {
  const release = jest.fn().mockResolvedValue(undefined);
  const lock = { acquire: jest.fn().mockResolvedValue(release) };
  const config = { get: jest.fn(() => 60) };
  const scheduler = new JobsScheduler(
    jobs,
    lock as unknown as LockService,
    config as unknown as ConfigService,
  );
  return { scheduler, lock, release, config };
}

describe('JobsScheduler', () => {
  it('每周期依次执行六个任务；任务抛错不中断后续任务', async () => {
    const first = job('a');
    const boom = job('b', jest.fn().mockRejectedValue(new Error('boom')));
    const third = job('c');
    const fourth = job('d');
    const fifth = job('e');
    const sixth = job('f');
    const { scheduler } = setup([first, boom, third, fourth, fifth, sixth]);

    await scheduler.runOnce();

    expect(first.run).toHaveBeenCalledTimes(1);
    expect(boom.run).toHaveBeenCalledTimes(1);
    expect(third.run).toHaveBeenCalledTimes(1);
    expect(fourth.run).toHaveBeenCalledTimes(1);
    expect(fifth.run).toHaveBeenCalledTimes(1);
    expect(sixth.run).toHaveBeenCalledTimes(1);
    expect(first.run.mock.invocationCallOrder[0]).toBeLessThan(
      sixth.run.mock.invocationCallOrder[0],
    );
  });

  it('每轮使用同一业务时间传给所有任务', async () => {
    const first = job('a');
    const second = job('b');
    const { scheduler } = setup([first, second]);

    await scheduler.runOnce();

    const firstNow = first.run.mock.calls[0][0] as Date;
    const secondNow = second.run.mock.calls[0][0] as Date;
    expect(firstNow).toBeInstanceOf(Date);
    expect(firstNow).toBe(secondNow);
  });

  it('锁被占用时本轮全部跳过', async () => {
    const first = job('a');
    const second = job('b');
    const { scheduler, lock } = setup([first, second]);
    lock.acquire.mockResolvedValue(null);

    await scheduler.runOnce();

    expect(first.run).not.toHaveBeenCalled();
    expect(second.run).not.toHaveBeenCalled();
  });

  it('按任务名获取锁并使用 120s TTL', async () => {
    const first = job('a');
    const { scheduler, lock } = setup([first]);

    await scheduler.runOnce();

    expect(lock.acquire).toHaveBeenCalledWith('job:a', JOB_LOCK_TTL_MS);
  });

  it('任务完成后释放锁', async () => {
    const first = job('a');
    const { scheduler, release } = setup([first]);

    await scheduler.runOnce();

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('任务抛错也释放锁', async () => {
    const boom = job('b', jest.fn().mockRejectedValue(new Error('boom')));
    const { scheduler, release } = setup([boom]);

    await scheduler.runOnce();

    expect(release).toHaveBeenCalledTimes(1);
  });

  it('获取锁抛错时跳过该任务并继续后续任务', async () => {
    const first = job('a');
    const second = job('b');
    const { scheduler, lock } = setup([first, second]);
    lock.acquire
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValueOnce(jest.fn().mockResolvedValue(undefined));

    await scheduler.runOnce();

    expect(first.run).not.toHaveBeenCalled();
    expect(second.run).toHaveBeenCalledTimes(1);
  });
});
