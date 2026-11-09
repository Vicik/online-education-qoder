import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Prisma 全局模块：提供数据库访问服务，全局可用
@Global() // 标记为全局模块，无需在其他模块中重复导入
@Module({
  providers: [PrismaService], // 注册 Prisma 服务
  exports: [PrismaService], // 导出 Prisma 服务供其他模块使用
})
export class PrismaModule {}
