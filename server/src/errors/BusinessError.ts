/**
 * 业务异常类。
 *
 * 作用：表示可预期的业务逻辑错误（参数无效、状态不满足、余额不足等），
 *       消息内容直接面向用户，由 errorHandler 中间件提取 message 返回前端。
 *
 * 与系统异常的区别：
 * - BusinessError：可预期，消息面向用户，HTTP 400，不记错误日志（仅 debug）。
 * - Error / 其他：不可预期，消息面向开发者，HTTP 500，记错误日志 + 不暴露堆栈。
 *
 * 使用约定：
 * - 服务层抛出 BusinessError 表达业务拒绝（如"票号已开奖"、"余额不足"）。
 * - 路由层不需要 catch，由 asyncHandler 转发至 errorHandler 统一处理。
 */
export class BusinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BusinessError';
  }
}
