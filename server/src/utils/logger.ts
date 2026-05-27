/**
 * 服务端日志工具（精简版）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：提供统一的日志入口，支持 info/warn/error/debug 级别。
 * 2. 不做什么：不做复杂的多 scope 子 logger，不做 console 桥接。
 *
 * 输入 / 输出：
 * - 输入：日志消息和可选参数。
 * - 输出：格式化的日志输出到 stdout。
 *
 * 关键边界条件与坑点：
 * 1. pino 导入方式需要使用 pino() 函数调用，不能用 pino.pino。
 * 2. createScopedLogger 为精简版空实现，仅返回 logger 本身。
 */
import pino from 'pino';

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

export const logger = pino({
  level: LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

export default logger;

/**
 * 创建 scope 子 logger（精简版空实现）。
 * 精简版不实现多 scope，直接返回主 logger。
 */
export const createScopedLogger = (_scope: string): pino.Logger => {
  return logger;
};