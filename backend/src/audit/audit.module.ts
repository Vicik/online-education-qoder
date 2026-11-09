import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

// 审计模块：全局模块，所有业务模块可直接注入 AuditService 记录管理端写操作
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
