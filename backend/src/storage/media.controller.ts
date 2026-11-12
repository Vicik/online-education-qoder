import {
  Controller,
  Get,
  Next,
  Query,
  Res,
} from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { ErrorCode } from '../common/constants/error-codes';
import { BizException } from '../common/exceptions/biz.exception';
import { Public } from '../common/decorators/public.decorator';
import { StorageService } from './storage.service';

// 媒体读取：签名即授权，支持 Range
@Controller('files')
export class MediaController {
  // 构造函数：注入存储服务
  constructor(private readonly storage: StorageService) {}

  // 读取媒体：验签 → 确认存在 → X-Accel 或直接发送
  @Get('media')
  @Public()
  async media(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() response: Response,
    @Next() next: NextFunction,
  ): Promise<void> {
    // 过期时间转数字
    const expires = Number(exp);
    // 签名必须有效
    if (
      !key ||
      !sig ||
      !Number.isInteger(expires) ||
      !this.storage.verifyMediaSignature(key, expires, sig)
    ) {
      throw new BizException(ErrorCode.FORBIDDEN, '链接无效或已过期', 403);
    }

    // 有效签名但文件不存在
    if (!(await this.storage.mediaExists(key))) {
      throw new BizException(ErrorCode.RESOURCE_NOT_FOUND, '文件不存在', 404);
    }

    // 生产环境交给 Nginx 发送，避免 Node 占用文件 IO
    const prefix = this.storage.xAccelPrefix();
    if (prefix) {
      const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
      response.setHeader('X-Accel-Redirect', `${normalized}${key}`);
      response.setHeader(
        'Cache-Control',
        'private, max-age=0, must-revalidate',
      );
      response.end();
      return;
    }

    // 开发/小流量环境由 Express 发送，自动支持 Range/206
    response.sendFile(
      this.storage.mediaFilePath(key),
      {
        headers: {
          'Content-Type': this.storage.mediaMimeForKey(key),
          'Content-Disposition': 'inline',
          'Cache-Control': 'private, max-age=0, must-revalidate',
          'X-Content-Type-Options': 'nosniff',
        },
        dotfiles: 'deny',
        acceptRanges: true,
      },
      (error) => {
        // 响应尚未发送时交给全局异常过滤器
        if (error && !response.headersSent) next(error);
      },
    );
  }
}
