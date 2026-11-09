import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { loadConfig } from './configuration';

// 应用配置模块：全局加载环境变量配置，供整个应用使用
@Module({
  imports: [
    // 初始化配置模块，设置为全局可用，加载自定义配置函数
    ConfigModule.forRoot({ isGlobal: true, load: [() => loadConfig()] }),
  ],
})
export class AppConfigModule {}
