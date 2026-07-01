/**
 * 常驻刮刮乐业务服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：购票（扣灵石 + 生成票据 + 结算 + 生成安保码）、兑奖（验安保码 + 发奖金）、
 *    查询兑奖历史、获取活跃票据。
 * 2. 不做什么：不决定玩法规则（由 puzzleCardTypes 内存常量提供）、不处理 JWT 签名细节（由 puzzleCardRedeemCode 负责）。
 *
 * 输入 / 输出：
 * - purchase：角色 ID + typeKey → 完整票据 DTO（含 redeemCode）。
 * - redeem：角色 ID + ticketId + redeemCode → 兑奖结果 DTO。
 * - getHistory：角色 ID + 分页 → 票据列表。
 * - getActiveTicket：角色 ID → 最近一张未兑奖票据或 null。
 *
 * 数据流 / 状态流：
 * 购票：锁角色行 → 扣灵石 → 取类型配置 → 生成 grid → 结算 → 生成 redeemCode →
 *       INSERT puzzle_card → 写流水（puzzle_buy）→ 返回 DTO。
 * 兑奖：SELECT FOR UPDATE 锁票 → 验 redeemCode → 原子 UPDATE redeemed_at →
 *       若奖金 > 0：加灵石 + 写流水（puzzle_prize）→ 返回结果。
 *
 * 复用设计说明：
 * - 类型配置/结算函数从 puzzleCardTypes 注册表读取，新增玩法无需改 service。
 * - 灵石增减使用 `spirit_stones = spirit_stones + $1` 原子表达式（CLAUDE.md 规范）。
 * - 流水写入复用 ledgerService.recordSpiritStones。
 *
 * 关键边界条件与坑点：
 * 1. ticket_number 用 INSERT ... SELECT MAX+1 原子递增，FOR UPDATE 锁角色行防并发。
 * 2. 购票事务内扣灵石在前，INSERT 在后；任一失败整体回滚。
 * 3. 兑奖时 redeemCode 验证必须在 UPDATE redeemed_at 之前，防止无效 code 标记已兑。
 * 4. 兑奖 atomic UPDATE 用 WHERE redeemed_at IS NULL 防并发重复。
 * 5. bigint 字段从 DB 读取后转 number 返回前端（值在 JS 安全范围内）。
 */
import { query, withTransaction } from '../../config/database.js';
import { Transactional } from '../../decorators/transactional.js';
import { recordSpiritStones, type SpiritStonesLedgerBizType } from '../ledgerService.js';
import { PUZZLE_CARD_TYPES, SETTLE_FNS, generateRandomGrid } from './puzzleCardTypes.js';
import { generateRedeemCode, verifyRedeemCode, type RedeemCodePayload } from './puzzleCardRedeemCode.js';

// ========== 类型定义 ==========

export interface PuzzleTicketDto {
  id: string;
  typeKey: string;
  ticketNumber: number;
  gridRows: number;
  gridCols: number;
  pricePaid: number;
  ticketData: { grid: number[] };
  matchedLines: Array<{ tierKey: string; tierName: string; prizeType: string; prizeAmount: number }>;
  prizeType: string;
  prizeAmount: number;
  redeemCode: string;
  redeemedAt: number | null;
  createdAt: number;
}

export interface HistoryItemDto {
  id: string;
  typeKey: string;
  typeName: string;
  ticketNumber: number;
  pricePaid: number;
  prizeType: string;
  prizeAmount: number;
  redeemCode: string | null;
  redeemedAt: number | null;
  createdAt: number;
}

export interface HistoryResult {
  items: HistoryItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface RedeemResultDto {
  id: string;
  prizeType: string;
  prizeAmount: number;
  redeemedAt: number;
}

// ========== 常量 ==========

const HISTORY_PAGE_SIZE = 20;
const TICKET_DATA_MIN = 1;
const TICKET_DATA_MAX = 6;

// ========== DTO 构建 ==========

const buildTicketDto = (
  row: {
    id: string | bigint;
    type_key: string;
    ticket_number: string | bigint;
    grid_rows: number;
    grid_cols: number;
    price_paid: string | bigint;
    ticket_data: { grid: number[] };
    matched_lines: Array<{ tierKey: string; tierName: string; prizeType: string; prizeAmount: number | string | bigint }>;
    prize_type: string;
    prize_amount: string | bigint;
    redeemed_at: Date | string | null;
    created_at: Date | string;
    epoch: number;
  },
  redeemCode: string,
): PuzzleTicketDto => ({
  id: String(row.id),
  typeKey: row.type_key,
  ticketNumber: Number(row.ticket_number),
  gridRows: row.grid_rows,
  gridCols: row.grid_cols,
  pricePaid: Number(row.price_paid),
  ticketData: row.ticket_data,
  matchedLines: row.matched_lines.map(m => ({ ...m, prizeAmount: Number(m.prizeAmount) })),
  prizeType: row.prize_type,
  prizeAmount: Number(row.prize_amount),
  redeemCode,
  redeemedAt: row.redeemed_at ? Math.floor(new Date(row.redeemed_at).getTime() / 1000) : null,
  createdAt: row.epoch,
});

// ========== 服务 ==========

class PuzzleCardService {
  /**
   * 购票：扣灵石 + 生成票据 + 结算 + 生成安保码。
   * 返回完整票据 DTO（含 redeemCode），奖金未入账。
   */
  @Transactional
  async purchase(characterId: number, typeKey: string): Promise<PuzzleTicketDto> {
    const typeConfig = PUZZLE_CARD_TYPES[typeKey];
    if (!typeConfig) throw new Error(`未知玩法类型：${typeKey}`);

    const settleFn = SETTLE_FNS[typeConfig.ruleType];
    if (!settleFn) throw new Error(`未知结算规则：${typeConfig.ruleType}`);

    // 1. 锁角色行（FOR UPDATE 保证 ticket_number 递增安全 + 余额原子操作）
    const charLock = await query<{ spirit_stones: string | bigint }>(
      `SELECT spirit_stones FROM characters WHERE id = $1 FOR UPDATE`,
      [characterId],
    );
    if (charLock.rows.length === 0) throw new Error('角色不存在');

    const currentBalance = BigInt(charLock.rows[0].spirit_stones);
    const price = typeConfig.price;
    if (currentBalance < price) throw new Error('灵石不足');

    // 2. 原子扣灵石
    const newBalance = currentBalance - price;
    await query(
      `UPDATE characters SET spirit_stones = spirit_stones - $1, updated_at = now() WHERE id = $2`,
      [price.toString(), characterId],
    );

    // 3. 原子递增 ticket_number
    const ticketNumResult = await query<{ ticket_number: string | bigint }>(
      `INSERT INTO puzzle_card (character_id, ticket_number, type_key, grid_rows, grid_cols, price_paid, ticket_data, matched_lines, prize_type, prize_amount, created_at)
       SELECT $1, COALESCE(MAX(ticket_number), 0) + 1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()
       FROM puzzle_card WHERE character_id = $1
       RETURNING ticket_number`,
      [
        characterId,
        typeConfig.typeKey,
        typeConfig.gridRows,
        typeConfig.gridCols,
        price.toString(),
        JSON.stringify({ grid: [] }),
        JSON.stringify([]),
        typeConfig.prizeTiers[0]?.prizeType ?? 'spirit_stones',
        0,
      ],
    );
    const ticketNumber = Number(ticketNumResult.rows[0].ticket_number);

    // 4. 生成格子数据 + 结算
    const gridLength = typeConfig.gridRows * typeConfig.gridCols * typeConfig.numbersPerCell;
    const grid = generateRandomGrid(gridLength, TICKET_DATA_MIN, TICKET_DATA_MAX);
    const settleResult = settleFn(grid);

    const ticketData = { grid };
    const matchedLines = settleResult.matchedLines.map(m => ({
      tierKey: m.tierKey,
      tierName: m.tierName,
      prizeType: m.prizeType,
      prizeAmount: Number(m.prizeAmount),
    }));
    const prizeType = settleResult.prizeType;
    const prizeAmount = Number(settleResult.prizeAmount);

    // 5. 更新 ticket_data + 结算结果
    await query(
      `UPDATE puzzle_card
       SET ticket_data = $1, matched_lines = $2, prize_type = $3, prize_amount = $4
       WHERE character_id = $5 AND ticket_number = $6`,
      [JSON.stringify(ticketData), JSON.stringify(matchedLines), prizeType, prizeAmount, characterId, ticketNumber],
    );

    // 6. 生成安保码
    const redeemCodePayload: RedeemCodePayload = {
      characterId,
      ticketNumber,
      typeKey: typeConfig.typeKey,
      gridRows: typeConfig.gridRows,
      gridCols: typeConfig.gridCols,
      pricePaid: Number(price),
      ticketData,
      matchedLines,
      prizeType,
      prizeAmount,
    };

    // TODO: 调试用，需要时取消注释
    // console.log('[puzzleCard] purchase generate payload:', JSON.stringify(redeemCodePayload, null, 2));

    const redeemCode = generateRedeemCode(redeemCodePayload);

    // 7. 查 epoch + 构建 DTO
    const insertedRow = await query<{
      id: string | bigint;
      type_key: string;
      ticket_number: string | bigint;
      grid_rows: number;
      grid_cols: number;
      price_paid: string | bigint;
      ticket_data: { grid: number[] };
      matched_lines: typeof matchedLines;
      prize_type: string;
      prize_amount: string | bigint;
      redeemed_at: null;
      created_at: Date | string;
      epoch: number;
    }>(
      `SELECT id, type_key, ticket_number, grid_rows, grid_cols, price_paid,
              ticket_data, matched_lines, prize_type, prize_amount, redeemed_at,
              created_at, EXTRACT(EPOCH FROM created_at) AS epoch
       FROM puzzle_card
       WHERE character_id = $1 AND ticket_number = $2`,
      [characterId, ticketNumber],
    );

    // 8. 写购票流水
    await recordSpiritStones({
      characterId,
      amount: -price,
      balanceAfter: newBalance,
      bizType: 'puzzle_buy' as SpiritStonesLedgerBizType,
      bizId: `puzzle:${insertedRow.rows[0].id}`,
      memo: `常驻刮刮乐购票：${typeConfig.name}`,
    });

    return buildTicketDto(insertedRow.rows[0] as never, redeemCode);
  }

  /**
   * 兑奖：验证安保码 + 原子标记已兑 + 发奖金。
   */
  @Transactional
  async redeem(characterId: number, ticketId: number, redeemCode: string): Promise<RedeemResultDto> {
    // 1. 锁票
    const lockResult = await query<{
      id: string | bigint;
      character_id: number;
      ticket_number: string | bigint;
      type_key: string;
      grid_rows: number;
      grid_cols: number;
      price_paid: string | bigint;
      ticket_data: unknown;
      matched_lines: unknown;
      prize_type: string;
      prize_amount: string | bigint;
      redeemed_at: Date | string | null;
    }>(
      `SELECT id, character_id, ticket_number, type_key, grid_rows, grid_cols,
              price_paid, ticket_data, matched_lines, prize_type, prize_amount, redeemed_at
       FROM puzzle_card
       WHERE id = $1 AND character_id = $2
       FOR UPDATE`,
      [ticketId, characterId],
    );

    if (lockResult.rows.length === 0) throw new Error('票据不存在');
    const row = lockResult.rows[0];

    if (row.redeemed_at !== null) throw new Error('票据已兑奖');

    // 2. 验证安保码
    const payload: RedeemCodePayload = {
      characterId: row.character_id,
      ticketNumber: Number(row.ticket_number),
      typeKey: row.type_key,
      gridRows: row.grid_rows,
      gridCols: row.grid_cols,
      pricePaid: Number(row.price_paid),
      ticketData: row.ticket_data,
      matchedLines: row.matched_lines,
      prizeType: row.prize_type,
      prizeAmount: Number(row.prize_amount),
    };
    if (!verifyRedeemCode(payload, redeemCode)) throw new Error('安保码无效');

    // 3. 原子标记已兑奖（防并发）
    const updateResult = await query(
      `UPDATE puzzle_card SET redeemed_at = NOW() WHERE id = $1 AND redeemed_at IS NULL`,
      [ticketId],
    );
    if (updateResult.rowCount === 0) throw new Error('兑奖失败，请重试');

    const redeemedAtRow = await query<{ epoch: number }>(
      `SELECT EXTRACT(EPOCH FROM redeemed_at) AS epoch FROM puzzle_card WHERE id = $1`,
      [ticketId],
    );
    const redeemedAt = Math.floor(Number(redeemedAtRow.rows[0].epoch));

    // 4. 发放奖金
    const prizeAmount = Number(row.prize_amount);
    if (prizeAmount > 0) {
      await query(
        `UPDATE characters SET spirit_stones = spirit_stones + $1, updated_at = now() WHERE id = $2`,
        [prizeAmount, characterId],
      );
      const balanceAfterRow = await query<{ spirit_stones: string | bigint }>(
        `SELECT spirit_stones FROM characters WHERE id = $1`,
        [characterId],
      );
      const balanceAfter = BigInt(balanceAfterRow.rows[0].spirit_stones);
      const typeConfig = PUZZLE_CARD_TYPES[row.type_key];
      await recordSpiritStones({
        characterId,
        amount: BigInt(prizeAmount),
        balanceAfter,
        bizType: 'puzzle_prize' as SpiritStonesLedgerBizType,
        bizId: `puzzle:${row.id}`,
        memo: `常驻刮刮乐兑奖：${typeConfig?.name ?? row.type_key}`,
      });
    }

    return {
      id: String(row.id),
      prizeType: row.prize_type,
      prizeAmount,
      redeemedAt,
    };
  }

  /**
   * 兑奖历史（分页，按创建时间倒序）。
   * 未兑奖票据附带 redeemCode（前端用于从历史页直接兑奖）。
   */
  async getHistory(characterId: number, page: number): Promise<HistoryResult> {
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const offset = (safePage - 1) * HISTORY_PAGE_SIZE;

    const [countResult, rowsResult] = await Promise.all([
      query<{ total: string | bigint }>(
        `SELECT COUNT(*)::bigint AS total FROM puzzle_card WHERE character_id = $1`,
        [characterId],
      ),
      query<{
        id: string | bigint;
        type_key: string;
        ticket_number: string | bigint;
        price_paid: string | bigint;
        prize_type: string;
        prize_amount: string | bigint;
        ticket_data: unknown;
        matched_lines: unknown;
        grid_rows: number;
        grid_cols: number;
        redeemed_at: Date | string | null;
        created_at: Date | string;
        epoch: number;
      }>(
        `SELECT id, type_key, ticket_number, price_paid, prize_type, prize_amount,
                ticket_data, matched_lines, grid_rows, grid_cols,
                redeemed_at, created_at, EXTRACT(EPOCH FROM created_at) AS epoch
         FROM puzzle_card
         WHERE character_id = $1
         ORDER BY ticket_number DESC
         LIMIT $2 OFFSET $3`,
        [characterId, HISTORY_PAGE_SIZE, offset],
      ),
    ]);

    const items: HistoryItemDto[] = rowsResult.rows.map(row => {
      const typeConfig = PUZZLE_CARD_TYPES[row.type_key];
      // 未兑奖票据：生成 redeemCode 供前端兑奖用
      let redeemCode: string | null = null;
      if (row.redeemed_at === null) {
        const payload: RedeemCodePayload = {
          characterId,
          ticketNumber: Number(row.ticket_number),
          typeKey: row.type_key,
          gridRows: row.grid_rows,
          gridCols: row.grid_cols,
          pricePaid: Number(row.price_paid),
          ticketData: row.ticket_data,
          matchedLines: row.matched_lines,
          prizeType: row.prize_type,
          prizeAmount: Number(row.prize_amount),
        };
        redeemCode = generateRedeemCode(payload);
      }

      return {
        id: String(row.id),
        typeKey: row.type_key,
        typeName: typeConfig?.name ?? row.type_key,
        ticketNumber: Number(row.ticket_number),
        pricePaid: Number(row.price_paid),
        prizeType: row.prize_type,
        prizeAmount: Number(row.prize_amount),
        redeemCode,
        redeemedAt: row.redeemed_at ? Math.floor(new Date(row.redeemed_at).getTime() / 1000) : null,
        createdAt: row.epoch,
      };
    });

    return {
      items,
      total: Number(countResult.rows[0].total),
      page: safePage,
      pageSize: HISTORY_PAGE_SIZE,
    };
  }

  /**
   * 获取当前活跃票据（最近一张未兑奖）。
   * 用于页面刷新后恢复刮奖界面。
   */
  async getActiveTicket(characterId: number): Promise<PuzzleTicketDto | null> {
    // 活跃票据：未兑奖的最后一张
    const result = await query<{
      id: string | bigint;
      type_key: string;
      ticket_number: string | bigint;
      grid_rows: number;
      grid_cols: number;
      price_paid: string | bigint;
      ticket_data: { grid: number[] };
      matched_lines: Array<{ tierKey: string; tierName: string; prizeType: string; prizeAmount: number | string | bigint }>;
      prize_type: string;
      prize_amount: string | bigint;
      redeemed_at: null;
      created_at: Date | string;
      epoch: number;
    }>(
      `SELECT id, type_key, ticket_number, grid_rows, grid_cols, price_paid,
              ticket_data, matched_lines, prize_type, prize_amount, redeemed_at,
              created_at, EXTRACT(EPOCH FROM created_at) AS epoch
       FROM puzzle_card
       WHERE character_id = $1 AND redeemed_at IS NULL
       ORDER BY ticket_number DESC
       LIMIT 1`,
      [characterId],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    // 活跃票据需要重新生成 redeemCode（不持久化）
    const payload: RedeemCodePayload = {
      characterId,
      ticketNumber: Number(row.ticket_number),
      typeKey: row.type_key,
      gridRows: row.grid_rows,
      gridCols: row.grid_cols,
      pricePaid: Number(row.price_paid),
      ticketData: row.ticket_data,
      matchedLines: row.matched_lines,
      prizeType: row.prize_type,
      prizeAmount: Number(row.prize_amount),
    };
    const redeemCode = generateRedeemCode(payload);

    return buildTicketDto(row as never, redeemCode);
  }
}

export const puzzleCardService = new PuzzleCardService();
