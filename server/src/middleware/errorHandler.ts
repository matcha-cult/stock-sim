/**
 * 全局错误处理中间件。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：捕获所有路由和服务层抛出的异常，统一返回 { success: false, message } 格式。
 * 2. 不做什么：不处理正常响应（headersSent 已发送的跳过）、不暴露堆栈信息给前端。
 *
 * 异常分类与处理策略：
 * - BusinessError：可预期的业务异常，HTTP 400，message 直接返回前端，仅 debug 日志。
 * - Error / 其他：不可预期的系统异常，HTTP 500，返回通用提示"服务器内部错误"，
 *   完整错误信息 + 堆栈写入 error 日志，便于排查。
 *
 * 输入 / 输出：
 * - 输入：Express 四参数错误中间件签名 (err, req, res, next)。
 * - 输出：JSON 响应 { success: false, message: string }。
 *
 * 数据流：
 * asyncHandler 捕获异常 -> next(err) -> errorHandler -> res.json
 *
 * 关键边界条件与坑点：
 * 1. 必须在所有路由之后注册，否则无法捕获路由中抛出的异常。
 * 2. headersSent 为 true 时只能交给 Express 默认处理器，避免重复写响应。
 * 3. 生产环境不返回堆栈，开发环境可酌情返回（当前统一不返回，堆栈只写日志）。
 */
import type { Request, Response, NextFunction } from 'express';
import { BusinessError } from '../errors/BusinessError.js';
import { logger } from '../utils/logger.js';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  // 响应已发送时交给 Express 默认处理器
  if (res.headersSent) {
    _next(err);
    return;
  }

  if (err instanceof BusinessError) {
    logger.debug(`[BusinessError] ${req.method} ${req.path}: ${err.message}`);
    res.status(400).json({ success: false, message: err.message });
    return;
  }

  // 未知异常：记录完整错误信息 + 堆栈，前端只看到通用提示
  logger.error(`[Error] ${req.method} ${req.path}: ${err.message}`, { stack: err.stack });
  res.status(500).json({ success: false, message: '服务器内部错误' });
};
