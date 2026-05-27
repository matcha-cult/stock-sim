import { createScopedLogger } from './logger.js';

/**
 * 慢操作日志工具。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：把“只在超过阈值时输出结构化慢日志”的规则收敛到单一工具，避免 battle/action、battle-session/advance、结算链路各自手写一套计时与阈值判断。
 * 2. 做什么：支持按阶段打点，帮助定位慢在总入口、开下一场、还是结算收尾。
 * 3. 不做什么：不持久化日志，不接管异常处理，也不自动包裹业务函数重试。
 *
 * 输入/输出：
 * - 输入：日志标签、基础字段、阈值、可选的时间源与输出函数。
 * - 输出：`mark` 记录阶段耗时，`flush` 在总耗时超过阈值时输出一条慢日志。
 *
 * 数据流/状态流：
 * 调用方创建 logger -> 各关键步骤调用 `mark`
 * -> 业务结束时调用 `flush`
 * -> 仅当 totalCostMs > thresholdMs 时输出包含分段耗时的结构化日志。
 *
 * 关键边界条件与坑点：
 * 1. `flush` 只允许生效一次，避免同一请求多次 return 时重复打慢日志。
 * 2. 阶段耗时按相邻 `mark` 的时间差计算；调用方若漏打某一段，不会阻塞日志输出，但会降低定位精度。
 */

type SlowLogValue = boolean | number | string | null | undefined;
type SlowOperationLogEntryValue = SlowLogValue | SlowLogStage[];

export type SlowLogFields = Record<string, SlowLogValue>;

export type SlowLogStage = {
  name: string;
  costMs: number;
} & SlowLogFields;

export type SlowOperationLogEntry = {
  kind: 'slow_operation';
  label: string;
  thresholdMs: number;
  totalCostMs: number;
  stages: SlowLogStage[];
} & Record<string, SlowOperationLogEntryValue>;

type SlowOperationLoggerOptions = {
  label: string;
  thresholdMs?: number;
  fields?: SlowLogFields;
  now?: () => number;
  write?: (entry: SlowOperationLogEntry) => void;
};

type SlowOperationLogger = {
  mark: (name: string, fields?: SlowLogFields) => void;
  flush: (fields?: SlowLogFields) => void;
};

const DEFAULT_SLOW_OPERATION_THRESHOLD_MS = 100;
const slowOperationLogger = createScopedLogger('slow-operation');

const roundCostMs = (value: number): number => {
  return Math.max(0, Math.round(value));
};

const mergeFields = (
  left?: SlowLogFields,
  right?: SlowLogFields,
): SlowLogFields => {
  return {
    ...(left ?? {}),
    ...(right ?? {}),
  };
};

const defaultWrite = (entry: SlowOperationLogEntry): void => {
  slowOperationLogger.warn(entry, 'slow operation');
};

export const createSlowOperationLogger = (
  options: SlowOperationLoggerOptions,
): SlowOperationLogger => {
  const now = options.now ?? Date.now;
  const write = options.write ?? defaultWrite;
  const thresholdMs = options.thresholdMs ?? DEFAULT_SLOW_OPERATION_THRESHOLD_MS;
  const startAt = now();
  let lastMarkAt = startAt;
  let flushed = false;
  const stages: SlowLogStage[] = [];

  return {
    mark: (name: string, fields?: SlowLogFields): void => {
      const currentAt = now();
      stages.push({
        name,
        costMs: roundCostMs(currentAt - lastMarkAt),
        ...(fields ?? {}),
      });
      lastMarkAt = currentAt;
    },
    flush: (fields?: SlowLogFields): void => {
      if (flushed) return;
      flushed = true;

      const endAt = now();
      const totalCostMs = roundCostMs(endAt - startAt);
      if (totalCostMs <= thresholdMs) {
        return;
      }

      if (endAt > lastMarkAt) {
        stages.push({
          name: 'tail',
          costMs: roundCostMs(endAt - lastMarkAt),
        });
      }

      write({
        kind: 'slow_operation',
        label: options.label,
        thresholdMs,
        totalCostMs,
        stages,
        ...mergeFields(options.fields, fields),
      });
    },
  };
};

export const SLOW_OPERATION_THRESHOLD_MS = DEFAULT_SLOW_OPERATION_THRESHOLD_MS;
