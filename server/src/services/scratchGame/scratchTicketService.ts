/**
 * 刮刮乐彩票服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理玩家每天的 3 张独立彩票——创建、刮格子、单张开奖。
 *    - 每天固定 3 张票（ticket_number=1/2/3），规格由种子配置驱动（3x3/4x4/5x5）。
 *    - overview 一次性创建全部 3 张票。
 *    - 只有当前未 settled 的票可以刮和结算。
 *    - 单张开奖后自动推进到下一张。
 * 2. 不做什么：不决定中奖规则（由 scratchPrizeConfigCache + scratchPrizeService 处理）。
 *
 * 输入 / 输出：
 * - 输入：角色 ID、格子索引、选线。
 * - 输出：概览 DTO、刮格子结果、开奖结果。
 *
 * 数据流 / 状态流：
 * 请求概览 -> 查已有票 -> 补齐缺失票 -> 返回概览 DTO；
 * 刮格子 -> 锁定票 -> 校验 settled=false + 未刮满 -> 更新 mask+count -> 返回格子值；
 * 开奖 -> 委托 scratchPrizeService 执行单张选线结算。
 *
 * 复用设计说明：
 * - 规格配置从 scratchPrizeConfigCache 读取，避免硬编码。
 * - 开奖委托给 scratchPrizeService，保持职责单一。
 * - 格子值生成使用 scratchTicketTypes.shuffleArray（[1..n] 随机排列）。
 *
 * 关键边界条件与坑点：
 * 1. 日期统一用 UTC 日期，避免时区导致"跨日重复生成"。
 * 2. 刮格子用 SELECT FOR UPDATE 防止并发双刮。
 * 3. 前端不能拿到完整 grid_values，只返回被刮格子的值。
 * 4. grid_values 长度必须与 grid_size 一致。
 * 5. 状态只有 active → settled 两种，没有中间态（无 completed）。
 */
import { withTransaction, query } from '../../config/database.js';
import { Transactional } from '../../decorators/transactional.js';
import { scratchPrizeConfigCache } from './scratchPrizeConfigCache.js';
import { scratchPrizeService } from './scratchPrizeService.js';
import { shuffleArray } from './scratchTicketTypes.js';
import type { SettleResultDto } from './scratchTicketTypes.js';

// ========== 常量 ==========

const TICKETS_PER_DAY = 3;

const CONFIG_KEYS = ['3x3', '4x4', '5x5'] as const;

// ========== 类型定义 ==========

export interface ScratchTicketDto {
  id: string;
  characterId: number;
  day: string;           // YYYY-MM-DD
  ticketNumber: number;  // 1/2/3
  configKey: string;     // "3x3"/"4x4"/"5x5"
  gridSize: number;      // 格子总数
  scratchCount: number;  // 已刮格子数
  maxScratchCount: number;  // 最大可刮数
  scratchedMask: number;    // 位标记，用于前端判断哪些格子已刮
  revealedValues: number[];   // 未刮格子为 0，已刮/已开奖为真实值
  settled: boolean;           // 是否已开奖（核心状态）
  selectedLine: string | null;
  lineSum: number | null;
  prizeTier: string | null;
  prizeTierName: string | null;  // 奖级名称（如"特等奖"）
  prizeAmount: number | null;
  resetFlag: boolean;            // 是否已被重置
  createdAt: number;
  updatedAt: number;
}

export interface OverviewDto {
  tickets: ScratchTicketDto[];
  settledCount: number;
  totalCount: number;       // 固定 3
  currentTicketNumber: number | null;  // 当前可操作票号（未 settled 的第一张）
  allSettled: boolean;
  canReset: boolean;        // 是否允许重置（allowResetTicket 开关打开且全部已兑奖）
}

export interface ScratchResultDto {
  ticket: ScratchTicketDto;
  cellIndex: number;
  cellValue: number;
  scratchCount: number;
  maxScratchCount: number;
}

export { SettleResultDto };

// ========== DTO 构建 ==========

/**
 * 根据 scratched_mask + grid_values 派生 revealedValues。
 * 已刮格子返回真实值，未刮格子为 0。
 * 已开奖的票（settled=true）返回完整 grid_values，不再依赖 mask。
 * 前端无需本地维护，刷新可恢复。
 */
const buildRevealedValues = (
  gridValues: number[],
  scratchedMask: number,
  gridSize: number,
  settled: boolean,
): number[] => {
  if (settled) {
    // 已开奖：返回完整 grid_values
    return [...gridValues];
  }
  return Array.from({ length: gridSize }, (_, i) =>
    (scratchedMask & (1 << i)) !== 0 ? gridValues[i] : 0,
  );
};

/** 查找奖级名称（从内存缓存） */
const lookupPrizeTierName = (configKey: string, prizeTier: string | null): string | null => {
  if (!prizeTier || prizeTier === 'none') return null;
  const tiers = scratchPrizeConfigCache.getPrizeTiers(configKey);
  if (!tiers) return null;
  const tier = tiers.find(t => t.tierKey === prizeTier);
  return tier?.tierName ?? null;
};

const buildTicketDto = (
  row: Record<string, unknown>,
  gridValues?: number[],
  forceSettled?: boolean,
): ScratchTicketDto => {
  const gridSize = Number(row.grid_size);
  const scratchedMask = Number(row.scratched_mask);
  const gv = gridValues ?? (row.grid_values as number[] | undefined) ?? [];
  const configKey = String(row.config_key ?? '');
  const settled = forceSettled ?? Boolean(row.settled);

  return {
    id: String(row.id),
    characterId: Number(row.character_id),
    day: String(row.day),
    ticketNumber: Number(row.ticket_number),
    configKey,
    gridSize,
    scratchCount: Number(row.scratch_count),
    maxScratchCount: Number(row.max_scratch_count),
    scratchedMask,
    revealedValues: buildRevealedValues(gv, scratchedMask, gridSize, settled),
    settled,
    selectedLine: row.selected_line ? String(row.selected_line) : null,
    lineSum: row.line_sum != null ? Number(row.line_sum) : null,
    prizeTier: row.prize_tier ? String(row.prize_tier) : null,
    prizeTierName: lookupPrizeTierName(configKey, row.prize_tier ? String(row.prize_tier) : null),
    prizeAmount: row.prize_amount != null ? Number(row.prize_amount) : null,
    resetFlag: Boolean(row.reset_flag),
    createdAt: new Date(row.created_at as string).getTime(),
    updatedAt: new Date(row.updated_at as string).getTime(),
  };
};

// ========== 公共逻辑 ==========

const getUtcDay = (): string => {
  const now = new Date();
  return now.toISOString().slice(0, 10);
};

/**
 * 确保当天有 TICKETS_PER_DAY 张票，一次性创建全部缺失票。
 */
const ensureDayTickets = async (characterId: number, day: string): Promise<ScratchTicketDto[]> => {
  const result = await query(
    `SELECT id, character_id, day, ticket_number, config_key, grid_size, grid_values,
            scratch_count, max_scratch_count, scratched_mask, status, settled, reset_flag,
            selected_line, line_sum, prize_tier, prize_amount, created_at, updated_at
     FROM scratch_ticket
     WHERE character_id = $1 AND day = $2
     ORDER BY ticket_number`,
    [characterId, day],
  );

  const existing: ScratchTicketDto[] = result.rows.map((r) =>
    buildTicketDto(r, r.grid_values as number[]),
  );

  if (existing.length >= TICKETS_PER_DAY) {
    return existing;
  }

  // 补齐缺失的票（一次性全部创建，不依赖前一张的状态）
  for (let i = 1; i <= TICKETS_PER_DAY; i++) {
    const exists = existing.find((t) => t.ticketNumber === i);
    if (!exists) {
      const configKey = CONFIG_KEYS[i - 1];
      const config = scratchPrizeConfigCache.getConfig(configKey);
      if (!config) {
        throw new Error(`票号 ${i} 对应的配置不存在`);
      }

      const gridValues = shuffleArray(config.gridSize);
      const insertResult = await query(
        `INSERT INTO scratch_ticket
          (character_id, day, ticket_number, config_key, grid_size, grid_values,
           scratched_mask, scratch_count, max_scratch_count, status, settled, reset_flag, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, 'active', false, false, now(), now())
         RETURNING id, character_id, day, ticket_number, config_key, grid_size, grid_values,
                   scratch_count, max_scratch_count, scratched_mask, status, settled, reset_flag,
                   selected_line, line_sum, prize_tier, prize_amount, created_at, updated_at`,
        [characterId, day, i, configKey, config.gridSize,
         JSON.stringify(gridValues), config.maxScratchCount],
      );
      if (insertResult.rows.length > 0) {
        existing.push(buildTicketDto(insertResult.rows[0], insertResult.rows[0].grid_values as number[]));
      }
    }
  }

  return existing.sort((a, b) => a.ticketNumber - b.ticketNumber);
};

// ========== 公开 API ==========

class ScratchTicketService {
  /**
   * 获取玩家当天的概览：所有票 + 当前可操作票号。
   */
  async overview(characterId: number): Promise<OverviewDto> {
    const day = getUtcDay();
    const tickets = await ensureDayTickets(characterId, day);

    const settledCount = tickets.filter((t) => t.settled).length;
    const allSettled = tickets.length === TICKETS_PER_DAY && tickets.every((t) => t.settled);
    const currentTicketNumber = tickets.find((t) => !t.settled)?.ticketNumber ?? null;
    const { allowResetTicket } = scratchPrizeConfigCache.getGlobalFlags();

    return {
      tickets,
      settledCount,
      totalCount: TICKETS_PER_DAY,
      currentTicketNumber,
      allSettled,
      canReset: allowResetTicket && allSettled,
    };
  }

  /**
   * 刮一个格子。
   * 使用 SELECT FOR UPDATE 防止并发双刮。
   * 返回票 DTO 中的 revealedValues（已刮格子为真实值，未刮格子为 0），不暴露完整 grid_values。
   */
  @Transactional
  async scratchCell(
    characterId: number,
    ticketNumber: number,
    cellIndex: number,
  ): Promise<ScratchResultDto> {
    if (ticketNumber < 1 || ticketNumber > TICKETS_PER_DAY) {
      throw new Error('票号无效');
    }

    const day = getUtcDay();

    const lockResult = await query(
      `SELECT id, character_id, day, ticket_number, config_key, grid_size, grid_values,
              scratch_count, max_scratch_count, scratched_mask, status, settled, reset_flag,
              selected_line, line_sum, prize_tier, prize_amount, created_at, updated_at
       FROM scratch_ticket
       WHERE character_id = $1 AND day = $2 AND ticket_number = $3
       LIMIT 1
       FOR UPDATE`,
      [characterId, day, ticketNumber],
    );

    if (lockResult.rows.length === 0) {
      throw new Error('彩票不存在，请先获取彩票');
    }

    const row = lockResult.rows[0];
    const gridSize = Number(row.grid_size);
    const maxScratchCount = Number(row.max_scratch_count);
    const scratchCount = Number(row.scratch_count);
    const scratchedMask = Number(row.scratched_mask);

    if (Boolean(row.settled)) {
      throw new Error('当前彩票已开奖，无法再刮');
    }
    if (cellIndex < 0 || cellIndex >= gridSize) {
      throw new Error('格子索引超出该票范围');
    }

    const cellBit = 1 << cellIndex;
    if ((scratchedMask & cellBit) !== 0) {
      throw new Error('该格子已经刮过了');
    }

    if (scratchCount >= maxScratchCount) {
      throw new Error('该票已刮满，请选择开奖线并点击开奖');
    }

    const gridValues: number[] = row.grid_values as number[];
    const cellValue = gridValues[cellIndex];

    const newMask = scratchedMask | cellBit;
    const newCount = scratchCount + 1;

    // 用 SQL 原子表达式：位掩码按位或、计数自增，避免依赖 JS 读到的旧值绝对值写回。
    // 当前方法已有 @Transactional + FOR UPDATE 保护，此处改为原子写法是为了与 CLAUDE.md
    // "数据库并发更新规范"严格对齐（防止未来有人拿走 FOR UPDATE 后埋下 lost update 隐患）。
    await query(
      `UPDATE scratch_ticket
       SET scratched_mask = scratched_mask | $1, scratch_count = scratch_count + 1, updated_at = now()
       WHERE id = $2`,
      [cellBit, String(row.id)],
    );

    // 构建更新后的 DTO
    const updatedTicket: ScratchTicketDto = {
      ...buildTicketDto(row),
      scratchedMask: newMask,
      scratchCount: newCount,
      revealedValues: buildRevealedValues(gridValues, newMask, gridSize, false),
    };

    return {
      ticket: updatedTicket,
      cellIndex,
      cellValue,
      scratchCount: newCount,
      maxScratchCount,
    };
  }

  /**
   * 开奖：单张票选线结算。
   * 前提：该票未 settled 且已刮满。
   */
  async settle(
    characterId: number,
    ticketNumber: number,
    lineKey: string,
  ): Promise<SettleResultDto> {
    return scratchPrizeService.settleSingle(characterId, ticketNumber, lineKey);
  }

  /**
   * 重置当天所有未开奖的票（清空刮痕、恢复初始状态）。
   */
  async resetTickets(characterId: number): Promise<ScratchTicketDto[]> {
    const day = getUtcDay();
    return withTransaction(async () => {
      await query(
        `UPDATE scratch_ticket
         SET scratched_mask = 0, scratch_count = 0,
             selected_line = null, line_sum = null,
             prize_tier = null, prize_amount = null,
             settled = false, status = 'active', reset_flag = true, updated_at = now()
         WHERE character_id = $1 AND day = $2 AND settled = true`,
        [characterId, day],
      );

      const result = await query(
        `SELECT id, character_id, day, ticket_number, config_key, grid_size, grid_values,
                scratch_count, max_scratch_count, scratched_mask, status, settled, reset_flag,
                selected_line, line_sum, prize_tier, prize_amount, created_at, updated_at
         FROM scratch_ticket
         WHERE character_id = $1 AND day = $2
         ORDER BY ticket_number`,
        [characterId, day],
      );

      return result.rows.map((r) => buildTicketDto(r, r.grid_values as number[]));
    });
  }
}

export const scratchTicketService = new ScratchTicketService();
