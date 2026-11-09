import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

// Crockford Base32 字符集：用于生成可读性强的随机 ID
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
// 合法请求 ID 正则：只允许字母、数字、点、下划线、连字符，长度 1-128
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

// 生成 ULID 格式的请求 ID：基于时间戳和随机熵
function ulid(): string {
  // 获取当前时间戳
  let timestamp = Date.now();
  // 时间戳部分字符串
  let time = '';
  // 将时间戳编码为 10 位 Crockford Base32 字符串
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[timestamp % 32] + time;
    timestamp = Math.floor(timestamp / 32);
  }
  // 生成 16 字节随机熵
  const entropy = randomBytes(16);
  // 随机部分字符串
  let random = '';
  // 将随机熵编码为 16 位 Crockford Base32 字符串
  for (let i = 0; i < 16; i += 1) random += CROCKFORD[entropy[i] % 32];
  // 返回时间戳部分 + 随机部分
  return time + random;
}

// 请求 ID 中间件：为每个请求生成或验证追踪 ID，并写入响应头
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  // 中间件处理方法：处理请求 ID 的生成和设置
  use(req: Request, res: Response, next: NextFunction): void {
    // 从请求头获取客户端传入的请求 ID
    const incoming = req.headers['x-request-id'];
    // 验证传入 ID 的合法性，不合法则生成新的 ID
    const requestId =
      typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
        ? incoming // 使用客户端传入的合法 ID
        : `req-${ulid()}`; // 生成新的 ULID 格式 ID

    // 将请求 ID 写回请求头，供后续处理使用
    req.headers['x-request-id'] = requestId;
    // 将请求 ID 设置到响应头，便于客户端追踪
    res.setHeader('X-Request-Id', requestId);
    // 继续处理请求
    next();
  }
}
