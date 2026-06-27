/**
 * Express Request 类型扩展。
 *
 * 作用：为 Express Request 添加 userId、characterId 和 marketDataApiKey 属性。
 */
import 'express';

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      characterId?: number;
      /** 行情 API 鉴权通过时写入的 sk- API key，用于 QPS 限流 scope */
      marketDataApiKey?: string;
    }
  }
}

export {};