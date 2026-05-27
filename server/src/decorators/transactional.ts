/**
 * 事务方法装饰器
 *
 * 作用：
 * - 标记 class 方法在数据库事务中执行
 * - 统一调用 withTransaction，确保方法在事务上下文中执行
 * - 成功 return → COMMIT，抛异常 → ROLLBACK
 *
 * 复用点：所有需要事务保证的 service 方法统一使用此装饰器
 *
 * 边界条件：
 * 1) 只能装饰返回 Promise 的异步方法
 * 2) 装饰器本身不处理嵌套语义，事务边界统一由 withTransaction 管理
 */
import { withTransaction } from '../config/database.js';

export function Transactional<A extends unknown[], R>(
  target: (this: unknown, ...args: A) => Promise<R>,
  _context: ClassMethodDecoratorContext,
): (this: unknown, ...args: A) => Promise<R> {
  return function (this: unknown, ...args: A): Promise<R> {
    return withTransaction(() => target.call(this, ...args));
  };
}
