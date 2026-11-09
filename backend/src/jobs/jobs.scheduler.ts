import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LockService } from '../redis/lock.service';

// 定时任务接口：名称用于锁键与日志，run 返回本轮处理条数
export interface Job {
  readonly name: string; // 任务名（如 groupon-expiry）
  run(now: Date): Promise<number>; // 扫描并把当前时间作为业务时间
}

// 任务锁注入令牌：单测可替换为内存锁
export const JOB_LOCK = 'JOB_LOCK';

// 任务集合注入令牌：Nest 无 multi provider，用工厂聚合六个任务
export const JOBS = 'JOBS';

// 单任务锁 TTL：需大于单任务最坏耗时，防止执行中被其他实例抢占
export const JOB_LOCK_TTL_MS = 120_000;

// 默认扫描间隔（秒）：配置缺失时兜底
const DEFAULT_SCAN_INTERVAL_SECONDS = 60;

// 调度器：按固定间隔依次执行任务，每个任务独立加锁并隔离异常
@Injectable()
export class JobsScheduler implements OnModuleInit, OnModuleDestroy {
  // 调度日志器
  private readonly logger = new Logger(JobsScheduler.name);
  // 周期定时器句柄
  private timer?: NodeJS.Timeout;
  // 上一轮是否仍在执行：防止同一实例内扫描重叠
  private cycleRunning = false;

  // 构造函数：注入任务集合、分布式锁与配置
  constructor(
    @Inject(JOBS) private readonly jobs: Job[], // 六个定时任务
    @Inject(JOB_LOCK) private readonly lock: LockService, // 任务级分布式锁
    private readonly config: ConfigService, // 读取扫描间隔
  ) {}

  // 模块初始化：仅在 Worker 进程（WORKER_MODE=true）启动调度
  onModuleInit(): void {
    // API 进程复用同一 AppModule，不能同时跑定时任务
    if (process.env.WORKER_MODE !== 'true') return;
    // 扫描间隔（秒）
    const intervalSeconds =
      this.config.get<number>('jobScanIntervalSeconds') ??
      DEFAULT_SCAN_INTERVAL_SECONDS;
    // 周期调度：上一轮未结束则跳过，不堆积
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalSeconds * 1000);
    // 启动后立即跑一轮，避免等待首个周期
    void this.tick();
  }

  // 模块销毁：清理定时器，保证测试与优雅退出可结束
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // 单轮调度入口：执行六个任务，任一任务异常不影响后续任务
  async runOnce(): Promise<void> {
    // 本轮统一业务时间：同轮任务看到相同 now，便于幂等与断言
    const now = new Date();
    for (const job of this.jobs) {
      // 任务开始时间（用于耗时日志）
      const startedAt = Date.now();
      // 释放锁函数
      let release: (() => Promise<void>) | null = null;
      try {
        // 尝试获取任务锁；获取失败说明其他实例正在执行
        release = await this.lock.acquire(`job:${job.name}`, JOB_LOCK_TTL_MS);
      } catch (error) {
        // Redis 不可用时只跳过本任务，后续任务继续尝试
        this.logger.error(
          JSON.stringify({
            task: job.name,
            event: 'lock-failed',
            message: (error as Error).message,
          }),
        );
        continue;
      }
      if (!release) {
        // 锁被其他实例占用：本轮跳过该任务
        this.logger.log(
          JSON.stringify({ task: job.name, event: 'skipped-locked' }),
        );
        continue;
      }
      try {
        // 执行任务并获取处理条数
        const processed = await job.run(now);
        // 结构化日志：任务名、处理数、耗时
        this.logger.log(
          JSON.stringify({
            task: job.name,
            event: 'finished',
            processed,
            durationMs: Date.now() - startedAt,
          }),
        );
      } catch (error) {
        // 单任务失败只记录，不中断后续任务
        this.logger.error(
          JSON.stringify({
            task: job.name,
            event: 'failed',
            message: (error as Error).message,
            durationMs: Date.now() - startedAt,
          }),
        );
      } finally {
        try {
          // 释放自己持有的锁（值匹配才删除）
          await release();
        } catch (error) {
          // 释放失败交给 TTL 自动过期
          this.logger.warn(
            JSON.stringify({
              task: job.name,
              event: 'release-failed',
              message: (error as Error).message,
            }),
          );
        }
      }
    }
  }

  // 定时器回调：同一实例内串行执行，避免扫描重叠
  private async tick(): Promise<void> {
    if (this.cycleRunning) {
      this.logger.warn(JSON.stringify({ event: 'cycle-skipped-overlap' }));
      return;
    }
    this.cycleRunning = true;
    try {
      await this.runOnce();
    } finally {
      this.cycleRunning = false;
    }
  }
}
