/**
 * Express Request 类型扩展。
 *
 * 作用：为 Express Request 添加 userId 和 characterId 属性。
 */
import 'express';

declare global {
  namespace Express {
    interface Request {
      userId?: number;
      characterId?: number;
    }
  }
}

export {};