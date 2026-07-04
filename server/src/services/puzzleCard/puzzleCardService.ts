/**
 * 常驻刮刮乐业务服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：购票（扣灵石 + 生成票据 + 结算 + 生成安保码）、批量购票（自动兑奖）、
 *    兑奖（验安保码 + 发奖金）、查询兑奖历史。
 * 2. 不做什么：不决定玩法规则（由 puzzleCardTypes 内存常量提供）、不处理 JWT 签名细节（由 puzzleCardRedeemCode 负责）。
 *
 * 输入 / 输出：
 * - purchase：角色 ID + typeKey → 完整票据 DTO（含 redeemCode）。
 * - batchPurchase：角色 ID + typeKey → 批量票据 + 汇总 DTO。
 * - redeem：角色 ID + ticketId + redeemCode → 兑奖结果 DTO。
 * - getHistory：角色 ID + 分页 → 票据列表。
 *
 * 数据流 / 状态流：
 * 购票：锁角色行 → 扣灵石 → 取类型配置 → 生成 grid → 结算 → 生成 redeemCode →
 *       INSERT puzzle_card → 写流水（puzzle_buy）→ 返回 DTO。
 * 批量购票：锁角色行 → 查当日张数 → 计算惩罚 → 扣总灵石 → 批量 INSERT →
 *           批量生成 grid + 结算 → 批量 UPDATE → 批量写流水 → 返回 DTO[]。
 * 兑奖：SELECT FOR UPDATE 锁票 → 验 redeemCode → 原子 UPDATE redeemed_at →
 *       若奖金 > 0：加灵石 + 写流水（puzzle_prize）→ 返回结果。
 *
 * 复用设计说明：
 * - 类型配置/结算函数从 puzzleCardTypes 注册表读取，新增玩法无需改 service。
 * - 灵石增减使用 `spirit_stones = spirit_stones + $1` 原子表达式（CLAUDE.md 规范）。
 * - 流水写入复用 ledgerService.recordSpiritStones。
 * - 周期起始时间使用 -8h 偏移补偿 PG timestamptz→timestamp 时区转换。
 *
 * 关键边界条件与坑点：
 * 1. ticket_number 用 INSERT ... SELECT MAX+1 原子递增，FOR UPDATE 锁角色行防并发。
 * 2. 购票事务内扣灵石在前，INSERT 在后；任一失败整体回滚。
 * 3. 兑奖时 redeemCode 验证必须在 UPDATE redeemed_at 之前，防止无效 code 标记已兑。
 * 4. 兑奖 atomic UPDATE 用 WHERE redeemed_at IS NULL 防并发重复。
 * 5. bigint 字段从 DB 读取后转 number 返回前端（值在 JS 安全范围内）。
 * 6. getCurrentPeriodStart 返回的 Date 需 -8h，因为 PG 会话时区 Asia/Shanghai 会把 UTC timestamptz
 *    参数 +8h 后再与 timestamp without time zone 列比较。
 */
import { query, withTransaction } from '../../config/database.js';
import { Transactional } from '../../decorators/transactional.js';
import { recordSpiritStones, type SpiritStonesLedgerBizType } from '../ledgerService.js';
import {
  PUZZLE_CARD_TYPES,
  SETTLE_FNS,
  generateRandomGrid,
  generateQixiGrid,
  generateSanyuanGrid,
  QIXI_PENALTY_MULTIPLIER,
  QIXI_PENALTY_THRESHOLD,
  QIXI_PRICE_MULTIPLIER,
  QIXI_PRICE_MULTIPLIER_THRESHOLD,
  QIXI_BATCH_SIZE,
  SANYUAN_PENALTY_MULTIPLIER,
  SANYUAN_PENALTY_THRESHOLD,
  SANYUAN_PRICE_MULTIPLIER,
  SANYUAN_PRICE_MULTIPLIER_THRESHOLD,
  SANYUAN_BATCH_SIZE,
} from './puzzleCardTypes.js';
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
  ticketData: { grid: number[] };
  matchedLines: Array<{ tierKey: string; tierName: string; prizeType: string; prizeAmount: number }>;
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

export interface PurchaseResultDto {
  ticket: PuzzleTicketDto;
  todayCount: number;
  todayThreshold: number;
}

export interface BatchPurchaseDto {
  tickets: PuzzleTicketDto[];
  totalCost: number;
  totalPrize: number;
  netProfit: number;
  todayCount: number;
  todayThreshold: number;
}

// ========== 常量 ==========

const HISTORY_PAGE_SIZE = 20;
const TICKET_DATA_MIN = 1;
const TICKET_DATA_MAX = 6;

// ========== 周期计算 ==========

/**
 * 计算当前周期起始时间。
 *
 * 设计说明：
 * - 每日周期从 UTC+8 08:00 开始刷新。
 * - 返回的 Date 传给 PG 后，PG 按 Asia/Shanghai 时区 +8h 转换为 timestamp without time zone。
 * - 因此需要 -8h 偏移补偿：想让 PG 比较时得到 UTC+8 00:00，就传 UTC-8:00 的 Date。
 *
 * 关键边界条件：
 * - UTC+8 08:00~次日 07:59 为一个完整周期（24h）。
 * - UTC 00:00~15:59 → 当天周期；UTC 16:00~23:59 → 前一天周期。
 */
const getCurrentPeriodStart = (): Date => {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);

  if (utcHour < 16) {
    // UTC 00:00~15:59 → UTC+8 08:00~23:59 → 今天周期
    // 减 8h：PG 收到 UTC-8:00 Date → 按 Asia/Shanghai +8h → UTC 00:00 ✓
    const offset = new Date(today);
    offset.setUTCHours(offset.getUTCHours() - 8);
    return offset;
  }
  // UTC 16:00~23:59 → UTC+8 00:00~07:59 → 昨天周期
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(yesterday.getUTCHours() - 8);
  return yesterday;
};

// ========== DTO 构建 ==========

interface TicketRow {
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
}

// ========== 服务 ==========

class PuzzleCardService {
  /**
   * 单张购票：扣灵石 + 生成票据 + 结算 + 生成安保码。
   * 返回完整票据 DTO（含 redeemCode），奖金未入账。
   */
  @Transactional
  async purchase(characterId: number, typeKey: string): Promise<PurchaseResultDto> {
    const typeConfig = PUZZLE_CARD_TYPES[typeKey];
    if (!typeConfig) throw new Error(`未知玩法类型：${typeKey}`);

    const settleFn = SETTLE_FNS[typeConfig.ruleType];
    if (!settleFn) throw new Error(`未知结算规则：${typeConfig.ruleType}`);

    // 0. 查询当日购票数，判定是否触发惩罚
    const periodStart = getCurrentPeriodStart();
    const todayCountResult = await query<{ count: string | bigint }>(
      `SELECT COUNT(*)::bigint AS count FROM puzzle_card
       WHERE character_id = $1 AND type_key = $2 AND created_at >= $3`,
      [characterId, typeKey, periodStart],
    );
    const todayCount = Number(todayCountResult.rows[0].count);

    const penaltyThreshold = typeKey === 'SANYUAN' ? SANYUAN_PENALTY_THRESHOLD : QIXI_PENALTY_THRESHOLD;
    const penaltyMultiplier = typeKey === 'SANYUAN' ? SANYUAN_PENALTY_MULTIPLIER : QIXI_PENALTY_MULTIPLIER;
    const priceMultiplierThreshold = typeKey === 'SANYUAN' ? SANYUAN_PRICE_MULTIPLIER_THRESHOLD : QIXI_PRICE_MULTIPLIER_THRESHOLD;
    const priceMultiplierValue = typeKey === 'SANYUAN' ? SANYUAN_PRICE_MULTIPLIER : QIXI_PRICE_MULTIPLIER;
    const isPenalized = todayCount >= penaltyThreshold;
    const probabilityMultiplierValue = isPenalized ? penaltyMultiplier : 1;
    const isPriceMultiplied = todayCount >= priceMultiplierThreshold;
    const actualPrice = typeConfig.price * BigInt(isPriceMultiplied ? priceMultiplierValue : 1);

    console.log(`[puzzleCard] purchase: characterId=${characterId}, typeKey=${typeKey}, ` +
      `todayCount=${todayCount}, threshold=${penaltyThreshold}, ` +
      `penalized=${isPenalized}, probabilityMultiplier=${probabilityMultiplierValue}, ` +
      `priceMultiplierThreshold=${priceMultiplierThreshold}, isPriceMultiplied=${isPriceMultiplied}, actualPrice=${actualPrice}`);

    // 1. 锁角色行（FOR UPDATE 保证 ticket_number 递增安全 + 余额原子操作）
    const charLock = await query<{ spirit_stones: string | bigint }>(
      `SELECT spirit_stones FROM characters WHERE id = $1 FOR UPDATE`,
      [characterId],
    );
    if (charLock.rows.length === 0) throw new Error('角色不存在');

    const currentBalance = BigInt(charLock.rows[0].spirit_stones);
    if (currentBalance < actualPrice) throw new Error('灵石不足');

    // 2. 原子扣灵石
    const newBalance = currentBalance - actualPrice;
    await query(
      `UPDATE characters SET spirit_stones = spirit_stones - $1, updated_at = now() WHERE id = $2`,
      [actualPrice.toString(), characterId],
    );

    // 3. 原子递增 ticket_number + 插入初始记录
    const insertedRow = await query<TicketRow>(
      `INSERT INTO puzzle_card (character_id, ticket_number, type_key, grid_rows, grid_cols, price_paid, ticket_data, matched_lines, prize_type, prize_amount, created_at)
       SELECT $1, COALESCE(MAX(ticket_number), 0) + 1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()
       FROM puzzle_card WHERE character_id = $1
       RETURNING id, type_key, ticket_number, grid_rows, grid_cols, price_paid,
                 ticket_data, matched_lines, prize_type, prize_amount, redeemed_at,
                 created_at, EXTRACT(EPOCH FROM created_at) AS epoch`,
      [
        characterId,
        typeConfig.typeKey,
        typeConfig.gridRows,
        typeConfig.gridCols,
        actualPrice.toString(),
        JSON.stringify({ grid: [] }),
        JSON.stringify([]),
        typeConfig.prizeTiers[0]?.prizeType ?? 'spirit_stones',
        0,
      ],
    );
    const ticketNumber = Number(insertedRow.rows[0].ticket_number);

    // 4. 生成格子数据 + 结算
    let grid: number[];
    if (typeConfig.typeKey === 'QIXI') {
      grid = generateQixiGrid(probabilityMultiplierValue);
    } else if (typeConfig.typeKey === 'SANYUAN') {
      grid = generateSanyuanGrid(probabilityMultiplierValue);
    } else {
      const gridLength = typeConfig.gridRows * typeConfig.gridCols * typeConfig.numbersPerCell;
      grid = generateRandomGrid(gridLength, TICKET_DATA_MIN, TICKET_DATA_MAX);
    }
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
      pricePaid: Number(actualPrice),
      ticketData,
      matchedLines,
      prizeType,
      prizeAmount,
    };
    const redeemCode = generateRedeemCode(redeemCodePayload);

    // 7. 写购票流水
    await recordSpiritStones({
      characterId,
      amount: -actualPrice,
      balanceAfter: newBalance,
      bizType: 'puzzle_buy' as SpiritStonesLedgerBizType,
      bizId: `puzzle:${insertedRow.rows[0].id}`,
      memo: `常驻刮刮乐购票：${typeConfig.name}`,
    });

    // 8. 构建返回 DTO（用生成后的数据，不用 INSERT 时的空数据）
    const row = insertedRow.rows[0];
    const todayThreshold = typeKey === 'SANYUAN' ? SANYUAN_PENALTY_THRESHOLD : QIXI_PENALTY_THRESHOLD;
    return {
      ticket: {
        id: String(row.id),
        typeKey: row.type_key,
        ticketNumber,
        gridRows: row.grid_rows,
        gridCols: row.grid_cols,
        pricePaid: Number(row.price_paid),
        ticketData,
        matchedLines,
        prizeType,
        prizeAmount,
        redeemCode,
        redeemedAt: null,
        createdAt: Math.floor(Number(row.epoch)),
      },
      todayCount: todayCount + 1,
      todayThreshold,
    };
  }

  /**
   * 批量购票：一次购买 QIXI_BATCH_SIZE 张。
   * 当日购票数超过 QIXI_PENALTY_THRESHOLD 后，中奖概率乘以 QIXI_PENALTY_MULTIPLIER。
   *
   * 关键设计：
   * - 无硬限购上限，但超阈值后概率惩罚使期望收益大幅降低。
   * - 整个批量在单个事务内完成，原子性保证。
   * - 使用批量 INSERT/UPDATE 减少 DB 往返。
   */
  @Transactional
  async batchPurchase(characterId: number, typeKey: string): Promise<BatchPurchaseDto> {
    const typeConfig = PUZZLE_CARD_TYPES[typeKey];
    if (!typeConfig) throw new Error(`未知玩法类型：${typeKey}`);

    const settleFn = SETTLE_FNS[typeConfig.ruleType];
    if (!settleFn) throw new Error(`未知结算规则：${typeConfig.ruleType}`);

    // 根据玩法类型选择批量大小
    const batchSize = typeKey === 'SANYUAN' ? SANYUAN_BATCH_SIZE : QIXI_BATCH_SIZE;

    // 2. 查询当日购票数，判定是否触发惩罚
    const periodStart = getCurrentPeriodStart();
    const todayCountResult = await query<{ count: string | bigint }>(
      `SELECT COUNT(*)::bigint AS count FROM puzzle_card
       WHERE character_id = $1 AND type_key = $2 AND created_at >= $3`,
      [characterId, typeKey, periodStart],
    );
    const todayCount = Number(todayCountResult.rows[0].count);

    // 根据玩法类型选择惩罚配置
    const penaltyThreshold = typeKey === 'SANYUAN' ? SANYUAN_PENALTY_THRESHOLD : QIXI_PENALTY_THRESHOLD;
    const penaltyMultiplier = typeKey === 'SANYUAN' ? SANYUAN_PENALTY_MULTIPLIER : QIXI_PENALTY_MULTIPLIER;
    const priceMultiplierThreshold = typeKey === 'SANYUAN' ? SANYUAN_PRICE_MULTIPLIER_THRESHOLD : QIXI_PRICE_MULTIPLIER_THRESHOLD;
    const priceMultiplierValue = typeKey === 'SANYUAN' ? SANYUAN_PRICE_MULTIPLIER : QIXI_PRICE_MULTIPLIER;

    const isPenalized = todayCount >= penaltyThreshold;
    const probabilityMultiplierValue = isPenalized ? penaltyMultiplier : 1;
    const isPriceMultiplied = todayCount >= priceMultiplierThreshold;
    const pricePerTicket = typeConfig.price * BigInt(isPriceMultiplied ? priceMultiplierValue : 1);
    const totalCostBigInt = pricePerTicket * BigInt(batchSize);

    console.log(`[puzzleCard] batchPurchase: characterId=${characterId}, typeKey=${typeKey}, ` +
      `todayCount=${todayCount}, threshold=${penaltyThreshold}, ` +
      `penalized=${isPenalized}, probabilityMultiplier=${probabilityMultiplierValue}, ` +
      `priceMultiplierThreshold=${priceMultiplierThreshold}, isPriceMultiplied=${isPriceMultiplied}, ` +
      `pricePerTicket=${pricePerTicket}, totalCost=${totalCostBigInt}, batchSize=${batchSize}`);

    // 1. 锁角色行
    const charLock = await query<{ spirit_stones: string | bigint }>(
      `SELECT spirit_stones FROM characters WHERE id = $1 FOR UPDATE`,
      [characterId],
    );
    if (charLock.rows.length === 0) throw new Error('角色不存在');

    const currentBalance = BigInt(charLock.rows[0].spirit_stones);
    if (currentBalance < totalCostBigInt) throw new Error('灵石不足');

    // 3. 原子扣总灵石
    const newBalance = currentBalance - totalCostBigInt;
    await query(
      `UPDATE characters SET spirit_stones = spirit_stones - $1, updated_at = now() WHERE id = $2`,
      [totalCostBigInt.toString(), characterId],
    );

    // 4. 批量 INSERT 初始记录
    const emptyTicketData = JSON.stringify({ grid: [] });
    const emptyMatchedLines = JSON.stringify([]);

    const typeKeys = Array(batchSize).fill(typeConfig.typeKey);
    const gridRowsArr = Array(batchSize).fill(typeConfig.gridRows);
    const gridColsArr = Array(batchSize).fill(typeConfig.gridCols);
    const pricesArr = Array(batchSize).fill(pricePerTicket.toString());
    const ticketDataArr = Array(batchSize).fill(emptyTicketData);
    const matchedLinesArr = Array(batchSize).fill(emptyMatchedLines);
    const prizeAmountsArr = Array(batchSize).fill(0);

    const insertResult = await query<TicketRow>(
      `INSERT INTO puzzle_card
         (character_id, ticket_number, type_key, grid_rows, grid_cols, price_paid, ticket_data, matched_lines, prize_type, prize_amount, created_at)
       SELECT $1,
              (SELECT COALESCE(MAX(ticket_number), 0) FROM puzzle_card WHERE character_id = $1) + s.idx,
              s.type_key, s.grid_rows, s.grid_cols, s.price_paid::bigint,
              s.ticket_data::jsonb, s.matched_lines::jsonb, ${typeConfig.prizeTiers[0]?.prizeType === 'silver' ? "'silver'" : "'spirit_stones'"}, s.prize_amount::bigint,
              NOW()
       FROM unnest($2::text[], $3::int[], $4::int[], $5::text[], $6::text[], $7::text[], $8::bigint[])
            WITH ORDINALITY AS s(type_key, grid_rows, grid_cols, price_paid, ticket_data, matched_lines, prize_amount, idx)
       RETURNING id, type_key, ticket_number, grid_rows, grid_cols, price_paid,
                 ticket_data, matched_lines, prize_type, prize_amount, redeemed_at,
                 created_at, EXTRACT(EPOCH FROM created_at) AS epoch`,
      [
        characterId,
        typeKeys,
        gridRowsArr,
        gridColsArr,
        pricesArr,
        ticketDataArr,
        matchedLinesArr,
        prizeAmountsArr,
      ],
    );

    // 5. 生成格子数据 + 结算 + 安保码
    const updateIds: string[] = [];
    const updateTicketData: string[] = [];
    const updateMatchedLines: string[] = [];
    const updatePrizeTypes: string[] = [];
    const updatePrizeAmounts: number[] = [];
    const redeemCodes: string[] = [];
    const tickets: PuzzleTicketDto[] = [];

    let runningBalance = newBalance;

    for (let i = 0; i < batchSize; i++) {
      const row = insertResult.rows[i];
      const ticketNumber = Number(row.ticket_number);

      // 生成格子 + 结算
      let grid: number[];
      if (typeConfig.typeKey === 'QIXI') {
        grid = generateQixiGrid(probabilityMultiplierValue);
      } else if (typeConfig.typeKey === 'SANYUAN') {
        grid = generateSanyuanGrid(probabilityMultiplierValue);
      } else {
        const gridLength = typeConfig.gridRows * typeConfig.gridCols * typeConfig.numbersPerCell;
        grid = generateRandomGrid(gridLength, TICKET_DATA_MIN, TICKET_DATA_MAX);
      }
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

      // 生成安保码
      const redeemCodePayload: RedeemCodePayload = {
        characterId,
        ticketNumber,
        typeKey: typeConfig.typeKey,
        gridRows: typeConfig.gridRows,
        gridCols: typeConfig.gridCols,
        pricePaid: Number(pricePerTicket),
        ticketData,
        matchedLines,
        prizeType,
        prizeAmount,
      };
      const redeemCode = generateRedeemCode(redeemCodePayload);

      updateIds.push(String(row.id));
      updateTicketData.push(JSON.stringify(ticketData));
      updateMatchedLines.push(JSON.stringify(matchedLines));
      updatePrizeTypes.push(prizeType);
      updatePrizeAmounts.push(prizeAmount);
      redeemCodes.push(redeemCode);

      // 写购票流水（balanceAfter 为扣完当前票后的余额）
      await recordSpiritStones({
        characterId,
        amount: -pricePerTicket,
        balanceAfter: runningBalance,
        bizType: 'puzzle_buy' as SpiritStonesLedgerBizType,
        bizId: `puzzle:${row.id}`,
        memo: `常驻刮刮乐批量购票：${typeConfig.name}`,
      });
      runningBalance -= pricePerTicket;

      // 构建返回 DTO（用生成后的数据，不用 INSERT 时的空数据）
      tickets.push({
        id: String(row.id),
        typeKey: row.type_key,
        ticketNumber,
        gridRows: row.grid_rows,
        gridCols: row.grid_cols,
        pricePaid: Number(row.price_paid),
        ticketData,
        matchedLines,
        prizeType,
        prizeAmount,
        redeemCode,
        redeemedAt: null,
        createdAt: Math.floor(Number(row.epoch)),
      });
    }

    // 6. 批量 UPDATE ticket_data + 结算结果
    await query(
      `UPDATE puzzle_card
       SET ticket_data = s.ticket_data::jsonb,
           matched_lines = s.matched_lines::jsonb,
           prize_type = s.prize_type,
           prize_amount = s.prize_amount::bigint
       FROM unnest($1::bigint[], $2::text[], $3::text[], $4::text[], $5::bigint[])
            WITH ORDINALITY AS s(id, ticket_data, matched_lines, prize_type, prize_amount, idx)
       WHERE puzzle_card.id = s.id`,
      [
        updateIds.map(id => Number(id)),
        updateTicketData,
        updateMatchedLines,
        updatePrizeTypes,
        updatePrizeAmounts,
      ],
    );

    // 7. 自动兑奖：仅标记中奖票据为已兑奖（未中奖票据保持 redeemed_at = NULL）
    const winningIds = tickets
      .filter((t) => t.prizeAmount > 0)
      .map((t) => Number(t.id));
    if (winningIds.length > 0) {
      await query(
        `UPDATE puzzle_card SET redeemed_at = NOW()
         WHERE id = ANY($1::bigint[]) AND redeemed_at IS NULL`,
        [winningIds],
      );
    }

    // 8. 汇总奖金，批量入账
    const totalPrize = updatePrizeAmounts.reduce((sum, amount) => sum + amount, 0);
    let prizeBalance = newBalance;
    if (totalPrize > 0) {
      prizeBalance = newBalance + BigInt(totalPrize);
      await query(
        `UPDATE characters SET spirit_stones = spirit_stones + $1, updated_at = now() WHERE id = $2`,
        [totalPrize, characterId],
      );
    }

    // 9. 写兑奖流水（仅中奖票据）
    for (let i = 0; i < batchSize; i++) {
      if (updatePrizeAmounts[i] > 0) {
        await recordSpiritStones({
          characterId,
          amount: BigInt(updatePrizeAmounts[i]),
          balanceAfter: prizeBalance,
          bizType: 'puzzle_prize' as SpiritStonesLedgerBizType,
          bizId: `puzzle:${updateIds[i]}`,
          memo: `常驻刮刮乐批量兑奖：${typeConfig.name}`,
        });
      }
    }

    // 10. 构建汇总
    return {
      tickets,
      totalCost: Number(totalCostBigInt),
      totalPrize,
      netProfit: totalPrize - Number(totalCostBigInt),
      todayCount: todayCount + batchSize,
      todayThreshold: penaltyThreshold,
    };
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

    // 未中奖票据无需兑奖
    const prizeAmount = Number(row.prize_amount);
    if (prizeAmount <= 0) throw new Error('未中奖票据无需兑奖');

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
        ticketData: row.ticket_data as { grid: number[] },
        matchedLines: (row.matched_lines as Array<{ tierKey: string; tierName: string; prizeType: string; prizeAmount: number | string }>)
          .map(m => ({ ...m, prizeAmount: Number(m.prizeAmount) })),
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
}

export const puzzleCardService = new PuzzleCardService();
