import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JobsScheduler } from './jobs/jobs.scheduler';

// Worker 进程入口：只初始化应用上下文，不监听 HTTP 端口
async function bootstrap(): Promise<void> {
  // 标记当前进程为 Worker：调度器据此启动定时扫描
  process.env.WORKER_MODE = 'true';

  // 创建应用上下文（OnModuleInit 中启动调度器）
  const app = await NestFactory.createApplicationContext(AppModule);
  // 显式获取调度器：确保模块已初始化，并便于后续扩展为手动触发
  app.get(JobsScheduler);
  // 优雅退出：收到 SIGTERM 时关闭定时器与数据库/Redis 连接
  app.enableShutdownHooks();

  new Logger('Worker').log('Worker 进程已启动，定时任务开始调度');
}

// 启动 Worker，异常退出交由进程管理器拉起
void bootstrap();
