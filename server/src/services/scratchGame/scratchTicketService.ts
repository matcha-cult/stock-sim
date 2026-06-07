/**
 * 刮刮乐彩票服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理玩家每天的 3 张独立彩票——按顺序创建、刮格子、触发开奖。
 *    - 每天固定 3 张票（ticket_number=1/2/3），规格由种子配置驱动（3x3/4x4/5x5）。
 *    - 必须刮完当前票所有格子才能开启下一张。
 *    - 3 张全部刮完后可执行开奖（settle），传入选线计算奖金。
 * 2. 不做什么：不决定中奖规则（由 scratchPrizeConfigCache + scratchPrizeService 处理）。
 *
 * 输入 / 输出：
 * - 输入：角色 ID、格子索引、选线列表。
 * - 输出：当天票列表 DTO、当前可刮票 DTO、刮格子结果、开奖结果。
 *
 * 数据流 / 状态流：
 * 请求当天票列表 -> 查已有票 -> 补齐缺失的票（从配置读取规格）-> 返回当前可刮票；
 * 刮格子 -> 锁定票 -> 校验状态/位 -> 更新 mask+count -> 返回格子值；
 * 开奖 -> 委托 scratchPrizeService 执行选线结算。
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
 */
import { withTransaction, query } from '../../config/database.js';
import { Transactional } from '../../decorators/transactional.js';
import { scratchPrizeConfigCache } from './scratchPrizeConfigCache.js';
import { scratchPrizeService } from './scratchPrizeService.js';
import { shuffleArray } from './scratchTicketTypes.js';
import type { TicketSettleInput, SettleResultDto } from './scratchTicketTypes.js';

// ========== 常量 ==========

const TICKETS_PER_DAY = 3;

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
  scratchedMask: number;
  status: string;        // active/completed/settled
  settled: boolean;
  selectedLine: string | null;
  lineSum: number | null;
  prizeTier: string | null;
  prizeAmount: number | null;
  /** 已刮格子返回真实值，未刮格子为 0。前端无需本地维护，刷新可恢复。 */
  revealedValues: number[];
  createdAt: number;
  updatedAt: number;
}

export interface DayTicketsDto {
  tickets: ScratchTicketDto[];
  currentTicket: ScratchTicketDto | null;
  completedCount: number;
  totalCount: number;
  allSettled: boolean;
}

export interface ScratchResultDto {
  ticket: ScratchTicketDto;
  cellIndex: number;
  cellValue: number;
  ticketCompleted: boolean;
  allCompleted: boolean;
}

export { SettleResultDto };

// ========== DTO 构建 ==========

/**
 * 根据 scratched_mask + grid_values 派生 revealedValues。
 * 已刮格子返回真实值，未刮格子为 0。前端无需本地维护，刷新可恢复。
 */
const buildRevealedValues = (
  gridValues: number[],
  scratchedMask: number,
  gridSize: number,
): number[] => {
  return Array.from({ length: gridSize }, (_, i) =>
    (scratchedMask & (1 << i)) !== 0 ? gridValues[i] : 0,
  );
};

const buildTicketDto = (
  row: Record<string, unknown>,
  gridValues?: number[],
): ScratchTicketDto => {
  const gridSize = Number(row.grid_size);
  const scratchedMask = Number(row.scratched_mask);
  const gv = gridValues ?? (row.grid_values as number[] | undefined) ?? [];

  return {
    id: String(row.id),
    characterId: Number(row.character_id),
    day: String(row.day),
    ticketNumber: Number(row.ticket_number),
    configKey: String(row.config_key ?? ''),
    gridSize,
    scratchCount: Number(row.scratch_count),
    maxScratchCount: Number(row.max_scratch_count),
    scratchedMask,
    status: String(row.status),
    settled: Boolean(row.settled),
    selectedLine: row.selected_line ? String(row.selected_line) : null,
    lineSum: row.line_sum != null ? Number(row.line_sum) : null,
    prizeTier: row.prize_tier ? String(row.prize_tier) : null,
    prizeAmount: row.prize_amount != null ? Number(row.prize_amount) : null,
    revealedValues: buildRevealedValues(gv, scratchedMask, gridSize),
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
 * 确保当天有 TICKETS_PER_DAY 张票，返回所有票。
 * 只在需要时创建新票（前一张 completed 后才创建下一张）。
 * 创建时从种子配置读取规格。
 */
const ensureDayTickets = async (characterId: number, day: string): Promise<ScratchTicketDto[]> => {
  const result = await query(
    `SELECT id, character_id, day, ticket_number, config_key, grid_size, grid_values,
            scratch_count, max_scratch_count, scratched_mask, status, settled,
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

  // 补齐缺失的票
  const toCreate: number[] = [];
  for (let i = 1; i <= TICKETS_PER_DAY; i++) {
    const exists = existing.find((t) => t.ticketNumber === i);
    if (!exists) {
      if (i > 1) {
        const prev = existing.find((t) => t.ticketNumber === i - 1);
        if (!prev || prev.status !== 'completed') {
          break;
        }
      }
      toCreate.push(i);
    }
  }

  for (const ticketNumber of toCreate) {
    const config = scratchPrizeConfigCache.getConfig(
      ticketNumber === 1 ? '3x3' : ticketNumber === 2 ? '4x4' : '5x5',
    );
    if (!config) {
      throw new Error(`票号 ${ticketNumber} 对应的配置不存在`);
    }

    const gridValues = shuffleArray(config.gridSize);
    const insertResult = await query(
      `INSERT INTO scratch_ticket
        (character_id, day, ticket_number, config_key, grid_size, grid_values,
         scratched_mask, scratch_count, max_scratch_count, status, settled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, $7, 'active', false, now(), now())
       RETURNING id, character_id, day, ticket_number, config_key, grid_size, grid_values,
                 scratch_count, max_scratch_count, scratched_mask, status, settled,
                 selected_line, line_sum, prize_tier, prize_amount, created_at, updated_at`,
      [characterId, day, ticketNumber, config.configKey, config.gridSize,
       JSON.stringify(gridValues), config.maxScratchCount],
    );
    if (insertResult.rows.length > 0) {
      existing.push(buildTicketDto(insertResult.rows[0], insertResult.rows[0].grid_values as number[]));
    }
  }

  return existing.sort((a, b) => a.ticketNumber - b.ticketNumber);
};

// ========== 公开 API ==========

class ScratchTicketService {
  /**
   * 获取玩家当天的所有票 + 当前可刮的票。
   */
  async getDayTickets(characterId: number): Promise<DayTicketsDto> {
    const day = getUtcDay();
    const tickets = await ensureDayTickets(characterId, day);

    const completedCount = tickets.filter((t) => t.status === 'completed').length;
    const allSettled = tickets.length === TICKETS_PER_DAY && tickets.every((t) => t.settled);

    const currentTicket = tickets.find((t) => t.status === 'active') ?? null;

    return {
      tickets,
      currentTicket,
      completedCount,
      totalCount: TICKETS_PER_DAY,
      allSettled,
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
      `SELECT id, character_id, day, ticket_number, grid_size, grid_values,
              scratch_count, max_scratch_count, scratched_mask, status, settled
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

    if (String(row.status) !== 'active') {
      throw new Error('当前彩票已结束');
    }
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

    const gridValues: number[] = row.grid_values as number[];
    const cellValue = gridValues[cellIndex];

    const newMask = scratchedMask | cellBit;
    const newCount = scratchCount + 1;
    const ticketCompleted = newCount >= maxScratchCount;
    const newStatus = ticketCompleted ? 'completed' : 'active';

    await query(
      `UPDATE scratch_ticket
       SET scratched_mask = $1, scratch_count = $2, status = $3, updated_at = now()
       WHERE id = $4`,
      [newMask, newCount, newStatus, String(row.id)],
    );

    const refreshedResult = await query(
      `SELECT id, character_id, day, ticket_number, config_key, grid_size, grid_values,
              scratch_count, max_scratch_count, scratched_mask, status, settled,
              selected_line, line_sum, prize_tier, prize_amount, created_at, updated_at
       FROM scratch_ticket
       WHERE id = $1
       LIMIT 1`,
      [String(row.id)],
    );

    const allCompleted = await this.checkAllCompleted(characterId, day);

    return {
      ticket: buildTicketDto(refreshedResult.rows[0], refreshedResult.rows[0].grid_values as number[]),
      cellIndex,
      cellValue,
      ticketCompleted,
      allCompleted,
    };
  }

  /**
   * 开奖：对当天所有票执行选线结算。
   * 前提：3 张票全部 completed，且均未 settled。
   */
  async settle(
    characterId: number,
    lines: TicketSettleInput[],
  ): Promise<SettleResultDto> {
    return scratchPrizeService.settle(characterId, lines);
  }

  // ========== 私有方法 ==========

  private async checkAllCompleted(characterId: number, day: string): Promise<boolean> {
    const result = await query(
      `SELECT COUNT(*) as cnt FROM scratch_ticket
       WHERE character_id = $1 AND day = $2 AND status = 'completed'`,
      [characterId, day],
    );
    return Number(result.rows[0].cnt) >= TICKETS_PER_DAY;
  }
}

export const scratchTicketService = new ScratchTicketService();
