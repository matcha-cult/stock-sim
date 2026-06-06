/**
 * 刮刮乐彩票服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理玩家每天的 3 张独立彩票——按顺序创建、刮格子、开奖。
 *    - 每天固定 3 张票（ticket_number=1/2/3），格子数由 GRID_SIZE 配置。
 *    - 必须刮完当前票所有格子才能开启下一张。
 *    - 3 张全部刮完后可执行开奖（settle），标记 settled=true。
 * 2. 不做什么：不决定中奖规则（等待用户提供）、不在路由层重复校验。
 *
 * 输入 / 输出：
 * - 输入：角色 ID、格子索引。
 * - 输出：当天票列表 DTO、当前可刮票 DTO、刮格子结果、开奖结果。
 *
 * 数据流 / 状态流：
 * 请求当天票列表 -> 查已有票 -> 补齐缺失的票（最多 3 张）-> 返回当前可刮票；
 * 刮格子 -> 锁定票 -> 校验状态/位 -> 更新 mask+count -> 返回格子值；
 * 开奖 -> 校验 3 张全 completed -> 标记 settled。
 *
 * 复用设计说明：
 * - 所有数据库查询和状态收敛集中在本服务，路由只做鉴权和参数归一化。
 * - DTO 构建纯函数化。
 *
 * 关键边界条件与坑点：
 * 1. 日期统一用 UTC 日期，避免时区导致"跨日重复生成"。
 * 2. 刮格子用 `SELECT ... FOR UPDATE` 防止并发双刮。
 * 3. 前端不能拿到完整 grid_values，只返回被刮格子的值。
 * 4. grid_values 长度必须与 grid_size 一致，INSERT 时需校验。
 */
import { withTransaction, query } from '../../config/database.js';
import { Transactional } from '../../decorators/transactional.js';

// ========== 类型定义 ==========

export interface ScratchTicketDto {
  id: string;
  characterId: number;
  day: string;           // YYYY-MM-DD
  ticketNumber: number;  // 1/2/3
  gridSize: number;      // 格子总数
  scratchCount: number;  // 已刮格子数
  scratchedMask: number;
  status: string;        // active/completed
  settled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DayTicketsDto {
  tickets: ScratchTicketDto[];    // 当天所有票（按 ticket_number 排序）
  currentTicket: ScratchTicketDto | null;  // 当前可刮的票
  completedCount: number;         // 已完成的票数
  totalCount: number;             // 总票数（固定 3）
  allSettled: boolean;            // 是否全部已开奖
}

export interface ScratchResultDto {
  ticket: ScratchTicketDto;
  cellIndex: number;
  cellValue: number;
  ticketCompleted: boolean;       // 这张票是否刚刮完
  allCompleted: boolean;          // 3 张是否全部刮完
}

export interface SettleResultDto {
  settled: boolean;
  tickets: ScratchTicketDto[];
}

// ========== 常量 ==========

const TICKETS_PER_DAY = 3;
const GRID_SIZE = 9;  // 可改为从配置读取，如 25=5x5

// ========== DTO 构建 ==========

const buildTicketDto = (row: Record<string, unknown>): ScratchTicketDto => ({
  id: String(row.id),
  characterId: Number(row.character_id),
  day: String(row.day),
  ticketNumber: Number(row.ticket_number),
  gridSize: Number(row.grid_size),
  scratchCount: Number(row.scratch_count),
  scratchedMask: Number(row.scratched_mask),
  status: String(row.status),
  settled: Boolean(row.settled),
  createdAt: new Date(row.created_at as string).getTime(),
  updatedAt: new Date(row.updated_at as string).getTime(),
});

// ========== 公共逻辑 ==========

const getUtcDay = (): string => {
  const now = new Date();
  return now.toISOString().slice(0, 10);
};

/**
 * 生成格子随机数字（占位逻辑，后续根据中奖规则替换）。
 * 当前：每个格子 0-9 随机整数。
 */
const generateGridValues = (gridSize: number): number[] => {
  const values: number[] = [];
  for (let i = 0; i < gridSize; i++) {
    values.push(Math.floor(Math.random() * 10));
  }
  return values;
};

/**
 * 确保当天有 TICKETS_PER_DAY 张票，返回所有票。
 * 只在需要时创建新票（前一张 completed 后才创建下一张）。
 */
const ensureDayTickets = async (characterId: number, day: string): Promise<ScratchTicketDto[]> => {
  // 查询当天已有的票
  const result = await query(
    `SELECT id, character_id, day, ticket_number, grid_size, scratch_count,
            scratched_mask, status, settled, created_at, updated_at
     FROM scratch_ticket
     WHERE character_id = $1 AND day = $2
     ORDER BY ticket_number`,
    [characterId, day],
  );

  const existing: ScratchTicketDto[] = result.rows.map(buildTicketDto);

  // 如果已经有 3 张，直接返回
  if (existing.length >= TICKETS_PER_DAY) {
    return existing;
  }

  // 否则补齐：只有前一张 completed 才创建下一张
  const toCreate: ScratchTicketDto[] = [];
  for (let i = 1; i <= TICKETS_PER_DAY; i++) {
    const exists = existing.find((t) => t.ticketNumber === i);
    if (!exists) {
      // 检查前一张是否已完成（第一张不需要检查）
      if (i > 1) {
        const prev = existing.find((t) => t.ticketNumber === i - 1);
        if (!prev || prev.status !== 'completed') {
          // 前一张没完成，不创建后续票
          break;
        }
      }
      toCreate.push({ ticketNumber: i } as ScratchTicketDto);
    }
  }

  // 批量创建缺失的票
  for (const ticket of toCreate) {
    const gridValues = generateGridValues(GRID_SIZE);
    const insertResult = await query(
      `INSERT INTO scratch_ticket
        (character_id, day, ticket_number, grid_size, grid_values, scratched_mask, scratch_count, status, settled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, 0, 'active', false, now(), now())
       RETURNING id, character_id, day, ticket_number, grid_size, scratch_count, scratched_mask, status, settled, created_at, updated_at`,
      [characterId, day, ticket.ticketNumber, GRID_SIZE, JSON.stringify(gridValues)],
    );
    if (insertResult.rows.length > 0) {
      existing.push(buildTicketDto(insertResult.rows[0]));
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

    // 当前可刮的票：第一张 active 的票
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
   * 只返回被刮格子的值，不返回完整 grid_values。
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
    if (cellIndex < 0 || cellIndex >= GRID_SIZE) {
      throw new Error('格子索引超出范围');
    }

    const day = getUtcDay();

    // 1. 锁定指定票
    const lockResult = await query(
      `SELECT id, character_id, day, ticket_number, grid_size, grid_values,
              scratch_count, scratched_mask, status, settled
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
    const scratchCount = Number(row.scratch_count);
    const scratchedMask = Number(row.scratched_mask);

    // 2. 校验状态
    if (String(row.status) !== 'active') {
      throw new Error('当前彩票已结束');
    }
    if (Boolean(row.settled)) {
      throw new Error('当前彩票已开奖，无法再刮');
    }
    if (cellIndex >= gridSize) {
      throw new Error('格子索引超出该票范围');
    }

    // 3. 校验格子是否已刮
    const cellBit = 1 << cellIndex;
    if ((scratchedMask & cellBit) !== 0) {
      throw new Error('该格子已经刮过了');
    }

    // 4. 获取该格子的值
    const gridValues: number[] = row.grid_values as number[];
    const cellValue = gridValues[cellIndex];

    // 5. 更新位标记和计数
    const newMask = scratchedMask | cellBit;
    const newCount = scratchCount + 1;
    const ticketCompleted = newCount >= gridSize;
    const newStatus = ticketCompleted ? 'completed' : 'active';

    await query(
      `UPDATE scratch_ticket
       SET scratched_mask = $1, scratch_count = $2, status = $3, updated_at = now()
       WHERE id = $4`,
      [newMask, newCount, newStatus, String(row.id)],
    );

    // 6. 刷新票状态
    const refreshedResult = await query(
      `SELECT id, character_id, day, ticket_number, grid_size, scratch_count,
              scratched_mask, status, settled, created_at, updated_at
       FROM scratch_ticket
       WHERE id = $1
       LIMIT 1`,
      [String(row.id)],
    );

    // 7. 检查 3 张是否全部完成
    const allCompleted = await this.checkAllCompleted(characterId, day);

    return {
      ticket: buildTicketDto(refreshedResult.rows[0]),
      cellIndex,
      cellValue,
      ticketCompleted,
      allCompleted,
    };
  }

  /**
   * 开奖：标记当天所有票为已开奖。
   * 前提：3 张票全部 completed。
   */
  @Transactional
  async settle(characterId: number): Promise<SettleResultDto> {
    const day = getUtcDay();

    // 1. 锁定当天所有票
    const lockResult = await query(
      `SELECT id, ticket_number, status, settled
       FROM scratch_ticket
       WHERE character_id = $1 AND day = $2
       ORDER BY ticket_number
       FOR UPDATE`,
      [characterId, day],
    );

    if (lockResult.rows.length === 0) {
      throw new Error('当天没有彩票');
    }

    const rows = lockResult.rows;
    const allDone = rows.every((r) => String(r.status) === 'completed');
    if (!allDone) {
      throw new Error('还有未刮完的票，无法开奖');
    }

    const anySettled = rows.some((r) => Boolean(r.settled));
    if (anySettled) {
      throw new Error('已经开奖过了');
    }

    // 2. 标记 settled
    await query(
      `UPDATE scratch_ticket
       SET settled = true, updated_at = now()
       WHERE character_id = $1 AND day = $2`,
      [characterId, day],
    );

    // 3. 刷新返回
    const refreshedResult = await query(
      `SELECT id, character_id, day, ticket_number, grid_size, scratch_count,
              scratched_mask, status, settled, created_at, updated_at
       FROM scratch_ticket
       WHERE character_id = $1 AND day = $2
       ORDER BY ticket_number`,
      [characterId, day],
    );

    return {
      settled: true,
      tickets: refreshedResult.rows.map(buildTicketDto),
    };
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
