import { Injectable } from '@nestjs/common';
import { GrouponUserService } from '../promotion/groupon/groupon.user.service';
import { Job } from './jobs.scheduler';

// 拼团到期任务：代理步骤 08 的失败退款逻辑（团失败、退款、券恢复，单事务且幂等）
@Injectable()
export class GrouponExpiryJob implements Job {
  // 任务名：同时作为分布式锁键后缀
  readonly name = 'groupon-expiry';

  // 构造函数：注入拼团用户端服务
  constructor(private readonly groupons: GrouponUserService) {}

  // 执行一轮扫描：返回实际失败的团组数
  run(now: Date): Promise<number> {
    return this.groupons.failExpiredGroups(now);
  }
}
