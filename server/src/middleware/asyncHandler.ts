/**
 * 异步路由处理器包装器。
 * 作用：自动捕获 async 路由中的异常并转发给 Express 全局错误中间件，
 *       消除路由中重复的 try/catch 样板代码。
 * 输入：async (req, res, next) => void 处理函数。
 * 输出：包装后的 Express 路由处理函数。
 *
 * 数据流：async handler 抛出异常 -> Promise.catch -> next(error) -> 全局错误中间件
 *
 * 边界条件：
 * 1) Express 4 不会自动捕获 async 函数的 rejection，必须手动转发至 next。
 * 2) 若处理函数在抛出前已调用 res.json/res.send，错误中间件会检查 res.headersSent 并跳过。
 */
import type { Request, Response, NextFunction } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler = (fn: AsyncRequestHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
