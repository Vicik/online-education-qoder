import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { CouponTemplateStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { Request } from 'express';
import { AuditContext } from '../../audit/audit.service';
import {
  CurrentUser,
  CurrentUserInfo,
} from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PageQuery } from '../../common/dto/page-query.dto';
import { CouponAdminService } from './coupon.admin.service';
import { CreateCouponTemplateDto } from './dto/create-coupon-template.dto';
import { UpdateCouponTemplateDto } from './dto/update-coupon-template.dto';

// 管理端模板列表查询：分页 + 状态筛选
class AdminCouponListQuery extends PageQuery {
  // 模板状态筛选
  @IsOptional()
  @IsEnum(CouponTemplateStatus)
  status?: CouponTemplateStatus;
}

// 停用请求体：version 可选（openapi 未声明请求体，design §8.4 要求乐观锁）
class DisableCouponTemplateDto {
  // 乐观锁版本号
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

// 优惠券模板管理端控制器：全部路由仅 admin 可访问（/api/v1/admin/coupons）
@Controller('admin/coupons')
@Roles('admin')
export class CouponAdminController {
  // 构造函数：注入模板管理服务
  constructor(private readonly coupons: CouponAdminService) {}

  // 模板列表
  @Get()
  list(@Query() query: AdminCouponListQuery) {
    return this.coupons.list(query, query.status);
  }

  // 创建模板（默认不启用）
  @Post()
  create(
    @Body() dto: CreateCouponTemplateDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.coupons.create(dto, this.auditContext(user, req));
  }

  // 模板详情
  @Get(':templateId')
  detail(@Param('templateId', ParseIntPipe) templateId: number) {
    return this.coupons.getDetail(templateId);
  }

  // 编辑模板（仅停用态可编辑）
  @Put(':templateId')
  update(
    @Param('templateId', ParseIntPipe) templateId: number,
    @Body() dto: UpdateCouponTemplateDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.coupons.update(templateId, dto, this.auditContext(user, req));
  }

  // 启用模板
  @Post(':templateId/enable')
  @HttpCode(HttpStatus.OK)
  enable(
    @Param('templateId', ParseIntPipe) templateId: number,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.coupons.enable(templateId, this.auditContext(user, req));
  }

  // 停用模板（级联未使用/已恢复记录为已失效）
  @Post(':templateId/disable')
  @HttpCode(HttpStatus.OK)
  disable(
    @Param('templateId', ParseIntPipe) templateId: number,
    @Body() dto: DisableCouponTemplateDto,
    @CurrentUser() user: CurrentUserInfo | null,
    @Req() req: Request,
  ) {
    return this.coupons.disable(
      templateId,
      dto?.version === undefined ? undefined : { version: dto.version },
      this.auditContext(user, req),
    );
  }

  // 从会话与请求中提取审计上下文
  private auditContext(
    user: CurrentUserInfo | null,
    req: Request,
  ): AuditContext {
    // 请求头中的追踪 id（由 RequestIdMiddleware 写入）
    const header = req.headers['x-request-id'];
    return {
      actorId: user!.userId, // 操作人
      ip: req.ip, // 客户端 IP
      requestId: typeof header === 'string' ? header : undefined, // 追踪 id
    };
  }
}
