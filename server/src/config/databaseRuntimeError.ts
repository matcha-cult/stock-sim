/**
 * PostgreSQL 运行时错误分类工具
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：集中识别可恢复的 PostgreSQL 运行时异常，供进程级异常处理与连接池事件复用。
 * 2. 做什么：把“锁冲突 / 语句取消 / 连接被服务端终止”等判断收敛到单一模块，避免 app 与数据库层各写一套。
 * 3. 不做什么：不创建连接、不执行重试、不吞掉业务错误，只负责纯判断与日志文案辅助。
 *
 * 输入/输出：
 * - 输入：`Error` 或兼容 `code/message/cause` 结构的错误对象。
 * - 输出：布尔值（是否为可恢复 PostgreSQL 异常）。
 *
 * 数据流/状态流：
 * 业务异常/连接池异常 -> 本模块沿 `cause` 链提取 code/message -> 统一分类 -> 调用方决定记录日志或阻止进程退出。
 *
 * 关键边界条件与坑点：
 * 1. `Connection terminated unexpectedly` 往往没有标准 SQLSTATE，必须同时支持按 message 识别，否则 `pool.on('error')` 无法命中。
 * 2. 这里只识别“可恢复”类别，不把所有数据库错误都当成瞬时错误；约束失败、字段缺失等业务/数据错误仍应正常暴露。
 */

type ErrorLike = {
  code?: string;
  message?: string;
  cause?: ErrorLike | Error | null;
};

const TRANSIENT_PG_ERROR_CODES = new Set<string>([
  '55P03',
  '57014',
  '57P01',
  '57P02',
  '57P03',
]);

const TRANSIENT_PG_ERROR_MESSAGE_PATTERNS = [
  /connection terminated unexpectedly/iu,
  /server closed the connection unexpectedly/iu,
  /terminating connection due to administrator command/iu,
  /client has encountered a connection error and is not queryable/iu,
] as const;

const normalizeErrorMessage = (
  error: Error | ErrorLike | null | undefined,
): string => {
  if (!error) {
    return '';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return typeof error.message === 'string' ? error.message : '';
};

const normalizeErrorCode = (
  error: Error | ErrorLike | null | undefined,
): string => {
  if (!error) {
    return '';
  }

  if (
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }

  return '';
};

const collectErrorChain = (
  error: Error | ErrorLike | null | undefined,
  maxDepth = 6,
): Array<Error | ErrorLike> => {
  const chain: Array<Error | ErrorLike> = [];
  let current: Error | ErrorLike | null | undefined = error;
  let depth = 0;

  while (current && depth < maxDepth) {
    chain.push(current);
    current = current.cause ?? null;
    depth += 1;
  }

  return chain;
};

const isTransientPgMessage = (message: string): boolean => {
  if (!message) {
    return false;
  }

  return TRANSIENT_PG_ERROR_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
};

export const isTransientPgError = (
  error: Error | ErrorLike | null | undefined,
): boolean => {
  const chain = collectErrorChain(error);

  return chain.some((entry) => {
    const code = normalizeErrorCode(entry);
    if (TRANSIENT_PG_ERROR_CODES.has(code)) {
      return true;
    }

    return isTransientPgMessage(normalizeErrorMessage(entry));
  });
};
