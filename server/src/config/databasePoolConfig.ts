/**
 * 数据库连接池配置统一入口
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：集中解析运行时连接池参数，避免 `database.ts`、部署配置与测试各自维护一套连接池数字。
 * 2. 做什么：为 `pg` 连接池统一收敛连接生命周期、空闲回收与保活策略，减少陈旧连接长期滞留带来的瞬时断链放大。
 * 3. 不做什么：不创建连接池、不执行数据库查询，也不负责重试策略。
 *
 * 输入 / 输出：
 * - 输入：环境变量对象，通常是 `process.env`。
 * - 输出：可直接传给 `new Pool(...)` 的稳定配置片段。
 *
 * 数据流 / 状态流：
 * `process.env` -> 解析并校验 `DB_POOL_*` / `DB_APPLICATION_NAME`
 * -> 生成标准化连接池配置 -> `database.ts` 复用。
 *
 * 复用设计说明：
 * - 把连接池参数从 `database.ts` 内联常量抽离成单一模块，避免运行时、测试与部署文档重复维护同一批规则。
 * - 当前由 `database.ts` 复用；后续若有诊断脚本、压测脚本需要读取同一套池参数，也应统一走这里。
 * - 连接池大小与生命周期是高频运维调整点，集中在这里能避免热修时漏改多处。
 *
 * 关键边界条件与坑点：
 * 1. `min` 不能大于 `max`，否则连接池在高并发前就会进入错误配置状态；这里必须启动即失败，不能静默纠正。
 * 2. 生命周期与超时参数只接受正整数，避免出现 `0`、负数或非法字符串把连接池带进不可预测状态。
 */

import type { PoolConfig } from 'pg';

type DatabasePoolEnvironment = NodeJS.ProcessEnv;

type DatabasePoolConfig = Pick<
  PoolConfig,
  | 'application_name'
  | 'connectionTimeoutMillis'
  | 'idleTimeoutMillis'
  | 'keepAlive'
  | 'keepAliveInitialDelayMillis'
  | 'max'
  | 'maxLifetimeSeconds'
  | 'maxUses'
  | 'min'
>;

const DEFAULT_DATABASE_POOL_CONFIG = {
  max: 800,
  min: 100,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 60_000,
  keepAliveInitialDelayMillis: 15_000,
  maxUses: 7_500,
  maxLifetimeSeconds: 900,
  applicationName: 'jiuzhou-server',
} as const;

const normalizeEnvValue = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
};

const readPositiveIntegerEnv = (
  env: DatabasePoolEnvironment,
  key: string,
  fallbackValue: number,
): number => {
  const rawValue = normalizeEnvValue(env[key]);
  if (rawValue === undefined) {
    return fallbackValue;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    throw new Error(`数据库连接池环境变量 ${key} 必须是正整数，当前值=${rawValue}`);
  }

  return parsedValue;
};

export const resolveDatabasePoolConfig = (
  env: DatabasePoolEnvironment,
): DatabasePoolConfig => {
  const max = readPositiveIntegerEnv(env, 'DB_POOL_MAX', DEFAULT_DATABASE_POOL_CONFIG.max);
  const min = readPositiveIntegerEnv(env, 'DB_POOL_MIN', DEFAULT_DATABASE_POOL_CONFIG.min);

  if (min > max) {
    throw new Error(`数据库连接池环境变量 DB_POOL_MIN 不能大于 DB_POOL_MAX，当前 min=${min} max=${max}`);
  }

  const applicationName = normalizeEnvValue(env.DB_APPLICATION_NAME)
    ?? DEFAULT_DATABASE_POOL_CONFIG.applicationName;

  return {
    application_name: applicationName,
    connectionTimeoutMillis: readPositiveIntegerEnv(
      env,
      'DB_POOL_CONNECT_TIMEOUT_MS',
      DEFAULT_DATABASE_POOL_CONFIG.connectionTimeoutMillis,
    ),
    idleTimeoutMillis: readPositiveIntegerEnv(
      env,
      'DB_POOL_IDLE_TIMEOUT_MS',
      DEFAULT_DATABASE_POOL_CONFIG.idleTimeoutMillis,
    ),
    keepAlive: true,
    keepAliveInitialDelayMillis: readPositiveIntegerEnv(
      env,
      'DB_POOL_KEEPALIVE_DELAY_MS',
      DEFAULT_DATABASE_POOL_CONFIG.keepAliveInitialDelayMillis,
    ),
    max,
    maxLifetimeSeconds: readPositiveIntegerEnv(
      env,
      'DB_POOL_MAX_LIFETIME_SECONDS',
      DEFAULT_DATABASE_POOL_CONFIG.maxLifetimeSeconds,
    ),
    maxUses: readPositiveIntegerEnv(
      env,
      'DB_POOL_MAX_USES',
      DEFAULT_DATABASE_POOL_CONFIG.maxUses,
    ),
    min,
  };
};
