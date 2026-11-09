import { Injectable } from '@nestjs/common';
import { OrderService } from '../trade/order/order.service';
import { Job } from './jobs.scheduler';

// 订单超时任务：pending 超过支付时限的订单取消并释放预占资源
@Injectable()
export class OrderTimeoutJob implements Job {
  // 任务名：同时作为分布式锁键后缀
  readonly name = 'order-timeout';

  // 构造函数：注入订单服务（取消逻辑位于交易领域）
  constructor(private readonly orders: OrderService) {}

  // 执行一轮扫描：返回实际取消的订单数
  run(now: Date): Promise<number> {
    return this.orders.cancelExpiredOrders(now);
  }
}
