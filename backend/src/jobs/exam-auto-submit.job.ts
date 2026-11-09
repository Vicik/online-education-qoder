import { Injectable } from '@nestjs/common';
import { ExamUserService } from '../exam/exam/exam.user.service';
import { Job } from './jobs.scheduler';

// 考试兜底交卷任务：代理步骤 10 的自动判分交卷（deadline 已过且未提交）
@Injectable()
export class ExamAutoSubmitJob implements Job {
  // 任务名：同时作为分布式锁键后缀
  readonly name = 'exam-auto-submit';

  // 构造函数：注入考试用户端服务
  constructor(private readonly exams: ExamUserService) {}

  // 执行一轮扫描：返回自动交卷的记录数
  run(now: Date): Promise<number> {
    return this.exams.autoSubmitExpired(now);
  }
}
