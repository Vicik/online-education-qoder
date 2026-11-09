import { Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { PageQuery } from '../../common/dto/page-query.dto';
import { OrderService } from './order.service';

// 管理端订单控制器：全部订单（客服/审计），仅 admin 可访问
@Controller('admin/orders')
@Roles('admin')
export class OrderAdminController {
  // 构造函数：注入订单服务
  constructor(private readonly orders: OrderService) {}

  // 全部订单分页（联查课程与用户信息）
  @Get()
  list(@Query() page: PageQuery) {
    return this.orders.listAllOrders(page);
  }
}
