/**
 * 灵石流水账服务（单式记账簿）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：记录每一笔灵石增减流水，提供玩家自查流水、GM 查询玩家流水（分页）的能力。
 * 2. 不做什么：不直接操作余额（余额仍由 consumeSpiritStones / addSpiritStones / updateCharacterSpiritStones 负责）。
 *
 * 输入 / 输出：
 * - recordSpiritStones：角色ID、变动量、变动后余额、业务类型、业务ID、对手方（可选）、备注。
 * - getOwnLedger：角色ID + 分页参数 -> 该角色的流水列表。
 * - gmQueryLedger：GM 查询参数（characterId/characterNickname 模糊匹配 + 分页） -> 流水列表。
 *
 * 数据流 / 状态流：
 * 业务侧在余额变更后同步调用 recordSpiritStones -> 写入 ledger 表。
 * 查询侧读 ledger 表，按 created_at 倒序。
 *
 * 关键边界条件与坑点：
 * 1. amount 可正可负，balance_after 由调用方保证 = 旧余额 + amount。
 * 2. GM 查询需要通过 character 关联过滤，但 ledger 本身只存 character_id。
 */
import { query } from '../config/database.js';

// ---- 类型定义 ----

export type SpiritStonesLedgerBizType =
  | 'stock_buy'
  | 'stock_sell'
  | 'stock_fee'
  | 'pending_create'
  | 'pending_fill'
  | 'pending_cancel'
  | 'shop_buy'
  | 'shop_upgrade'
  | 'shop_rent'
  | 'player_transfer'
  | 'player_trade'
  | 'system_grant'
  | 'system_deduct'
  | 'gm_compensation'
  | 'gm_rebate'
  | 'gm_grant_month_card'
  | 'gm_revoke_month_card'
  | 'scratch_prize'
  | 'puzzle_buy'
  | 'puzzle_prize'
  | 'month_card_daily'
  | 'farm_buy_seed'
  | 'farm_sell_seed'
  | 'farm_sell_harvest'
  | 'farm_reclaim'
  | 'farm_expand_cell'
  | 'farm_upgrade_tier'
  | 'farm_place_decoration'
  | 'altar_summon'
  | 'inventory_sell_item'
  | 'tier_up'
  | 'tier_up_auto_buy_pill'
  | 'tier_up_auto_buy_pill_refund'
  | 'other';

export interface RecordLedgerParams {
  characterId: number;
  amount: bigint;
  balanceAfter: bigint;
  bizType: SpiritStonesLedgerBizType;
  bizId?: string;
  counterparty?: number;
  memo?: string;
}

export interface LedgerRowDto {
  id: string;
  characterId: number;
  nickname: string;
  amount: number;
  balanceAfter: number;
  bizType: string;
  bizId: string | null;
  counterparty: number | null;
  counterpartyNickname: string | null;
  memo: string | null;
  createdAt: number;
}

// ---- 灵田内测守卫 ----

/** 灵田内测模式下跳过灵田相关流水记录，避免产生无意义的正式账目。 */
const isFarmBetaWipeMode = (): boolean => process.env.FARM_BETA_WIPE_MODE === 'true';

const FARM_BIZ_TYPE_PREFIX = 'farm_';

// ---- 核心写入 ----

/**
 * 记录一笔灵石流水。
 * 必须在事务内调用（由 @Transactional 或上层事务保证原子性）。
 * 灵田内测模式下，灵田业务类型（farm_*）的流水直接跳过。
 */
export const recordSpiritStones = async (params: RecordLedgerParams): Promise<void> => {
  if (isFarmBetaWipeMode() && params.bizType.startsWith(FARM_BIZ_TYPE_PREFIX)) return;
  await query(
    `
    INSERT INTO spirit_stones_ledger
      (character_id, amount, balance_after, biz_type, biz_id, counterparty, memo, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `,
    [
      params.characterId,
      params.amount.toString(),
      params.balanceAfter.toString(),
      params.bizType,
      params.bizId ?? null,
      params.counterparty ?? null,
      params.memo ?? null,
    ],
  );
};

// ---- 玩家自查 ----

const LEDGER_PAGE_SIZE = 20;

export interface OwnLedgerResult {
  records: LedgerRowDto[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 查询当前角色的灵石流水。
 */
export const getOwnLedger = async (
  characterId: number,
  page: number = 1,
): Promise<OwnLedgerResult> => {
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const offset = (safePage - 1) * LEDGER_PAGE_SIZE;

  const [countResult, rowsResult] = await Promise.all([
    query<{ total: string | number }>(
      `SELECT COUNT(*)::bigint AS total FROM spirit_stones_ledger WHERE character_id = $1`,
      [characterId],
    ),
    query<{
      id: string | number | bigint;
      character_id: number;
      amount: string | number | bigint;
      balance_after: string | number | bigint;
      biz_type: string;
      biz_id: string | null;
      counterparty: number | null;
      memo: string | null;
      created_at: Date | string;
      epoch: number;
    }>(
      `
      SELECT id, character_id, amount, balance_after, biz_type, biz_id,
             counterparty, memo, created_at,
             EXTRACT(EPOCH FROM created_at) AS epoch
      FROM spirit_stones_ledger
      WHERE character_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3
      `,
      [characterId, LEDGER_PAGE_SIZE, offset],
    ),
  ]);

  const total = Number(countResult.rows[0].total);
  const records = await enrichLedgerRows(rowsResult.rows);

  return { records, total, page: safePage, pageSize: LEDGER_PAGE_SIZE };
};

// ---- GM 查询 ----

export interface GmLedgerQueryParams {
  characterId?: number;
  nicknameKeyword?: string;
  bizType?: string;
  page?: number;
}

export interface GmLedgerResult {
  records: LedgerRowDto[];
  total: number;
  page: number;
  pageSize: number;
}

// ---- 内部工具：构建 GM 查询 WHERE 条件 ----

type GmLedgerWhereResult = {
  whereClause: string;
  values: unknown[];
};

const buildGmLedgerWhere = (params: GmLedgerQueryParams): GmLedgerWhereResult => {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let vi = 1;

  if (params.characterId != null) {
    conditions.push(`l.character_id = $${vi}`);
    values.push(params.characterId);
    vi++;
  }

  if (params.nicknameKeyword) {
    conditions.push(`c.nickname ILIKE '%' || $${vi} || '%'`);
    values.push(params.nicknameKeyword);
    vi++;
  }

  if (params.bizType) {
    conditions.push(`l.biz_type = $${vi}`);
    values.push(params.bizType);
    vi++;
  }

  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
};

/**
 * GM 查询玩家灵石流水（支持按角色ID、昵称模糊、业务类型过滤）。
 */
export const gmQueryLedger = async (
  params: GmLedgerQueryParams,
): Promise<GmLedgerResult> => {
  const pageNum = params.page ?? 1;
  const safePage = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : 1;
  const offset = (safePage - 1) * LEDGER_PAGE_SIZE;

  const { whereClause, values } = buildGmLedgerWhere(params);
  const vi = values.length + 1;

  const countResult = await query<{ total: string | number }>(
    `
    SELECT COUNT(*)::bigint AS total
    FROM spirit_stones_ledger l
    INNER JOIN characters c ON c.id = l.character_id
    ${whereClause}
    `,
    values,
  );

  const rowsResult = await query<{
    id: string | number | bigint;
    character_id: number;
    amount: string | number | bigint;
    balance_after: string | number | bigint;
    biz_type: string;
    biz_id: string | null;
    counterparty: number | null;
    memo: string | null;
    created_at: Date | string;
    epoch: number;
  }>(
    `
    SELECT l.id, l.character_id, l.amount, l.balance_after, l.biz_type, l.biz_id,
           l.counterparty, l.memo, l.created_at,
           EXTRACT(EPOCH FROM l.created_at) AS epoch
    FROM spirit_stones_ledger l
    INNER JOIN characters c ON c.id = l.character_id
    ${whereClause}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT $${vi} OFFSET $${vi + 1}
    `,
    [...values, LEDGER_PAGE_SIZE, offset],
  );

  const total = Number(countResult.rows[0].total);
  const records = await enrichLedgerRows(rowsResult.rows);

  return { records, total, page: safePage, pageSize: LEDGER_PAGE_SIZE };
};

/**
 * GM 全量导出玩家灵石流水（无分页限制，用于 CSV 导出）。
 * 返回 5000 条上限，防止一次性拉取过多数据。
 */
const GM_EXPORT_MAX_ROWS = 5000;

export interface GmLedgerExportResult {
  records: LedgerRowDto[];
  total: number;
}

export const gmExportAllLedger = async (
  params: Omit<GmLedgerQueryParams, 'page'>,
): Promise<GmLedgerExportResult> => {
  const { whereClause, values } = buildGmLedgerWhere(params);

  const countResult = await query<{ total: string | number }>(
    `
    SELECT COUNT(*)::bigint AS total
    FROM spirit_stones_ledger l
    INNER JOIN characters c ON c.id = l.character_id
    ${whereClause}
    `,
    values,
  );

  const total = Number(countResult.rows[0].total);
  const rowsResult = await query<{
    id: string | number | bigint;
    character_id: number;
    amount: string | number | bigint;
    balance_after: string | number | bigint;
    biz_type: string;
    biz_id: string | null;
    counterparty: number | null;
    memo: string | null;
    created_at: Date | string;
    epoch: number;
  }>(
    `
    SELECT l.id, l.character_id, l.amount, l.balance_after, l.biz_type, l.biz_id,
           l.counterparty, l.memo, l.created_at,
           EXTRACT(EPOCH FROM l.created_at) AS epoch
    FROM spirit_stones_ledger l
    INNER JOIN characters c ON c.id = l.character_id
    ${whereClause}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT $${values.length + 1}
    `,
    [...values, GM_EXPORT_MAX_ROWS],
  );

  const records = await enrichLedgerRows(rowsResult.rows);

  return { records, total };
};

// ---- 内部工具 ----

/**
 * 为流水行补充 nickname 字段（需要额外查 characters 表）。
 */
const enrichLedgerRows = async (rows: {
  id: string | number | bigint;
  character_id: number;
  amount: string | number | bigint;
  balance_after: string | number | bigint;
  biz_type: string;
  biz_id: string | null;
  counterparty: number | null;
  memo: string | null;
  created_at: Date | string;
  epoch: number;
}[]): Promise<LedgerRowDto[]> => {
  if (rows.length === 0) return [];

  const characterIds = new Set<number>();
  for (const row of rows) {
    characterIds.add(row.character_id);
    if (row.counterparty != null) characterIds.add(row.counterparty);
  }

  const nicknames = new Map<number, string>();
  if (characterIds.size > 0) {
    const nickResult = await query<{ id: number; nickname: string }>(
      `SELECT id, nickname FROM characters WHERE id = ANY($1::int[])`,
      [Array.from(characterIds)],
    );
    for (const r of nickResult.rows) {
      nicknames.set(r.id, r.nickname);
    }
  }

  return rows.map((row) => {
    // 使用 PostgreSQL 的 EXTRACT(EPOCH) 而不是 Date.getTime()
    // 原因：列是 timestamp without time zone + DB 时区 UTC，
    // node-postgres 把存储值当作 UTC 解析为 Date，导致 getTime() 产生的 epoch 偏小 8 小时
    const createdAt = Math.floor(Number(row.epoch));

    return {
      id: String(row.id),
      characterId: row.character_id,
      nickname: nicknames.get(row.character_id) ?? '',
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      bizType: row.biz_type,
      bizId: row.biz_id,
      counterparty: row.counterparty,
      counterpartyNickname: row.counterparty != null
        ? (nicknames.get(row.counterparty) ?? null)
        : null,
      memo: row.memo,
      createdAt,
    };
  });
};

// ---- biz_type 中文映射 ----

export const LEDGER_BIZ_TYPE_LABELS: Record<SpiritStonesLedgerBizType, string> = {
  stock_buy: '股市买入',
  stock_sell: '股市卖出',
  stock_fee: '交易手续费',
  pending_create: '挂单创建',
  pending_fill: '挂单成交',
  pending_cancel: '挂单取消',
  shop_buy: '店铺购买',
  shop_upgrade: '店铺升级',
  shop_rent: '收取租金',
  player_transfer: '玩家转账',
  player_trade: '玩家交易',
  system_grant: '系统发放',
  system_deduct: '系统扣除',
  gm_compensation: 'GM维护补偿',
  gm_rebate: 'GM补涨',
  gm_grant_month_card: 'GM 发放月卡',
  gm_revoke_month_card: 'GM 回收月卡',
  month_card_daily: '月卡每日领取',
  scratch_prize: '刮刮乐奖金',
  puzzle_buy: '无限刮刮乐购票',
  puzzle_prize: '无限刮刮乐奖金',
  farm_buy_seed: '灵田购买种子',
  farm_sell_seed: '灵田出售种子',
  farm_sell_harvest: '灵田出售灵材',
  farm_reclaim: '灵田开垦',
  farm_expand_cell: '灵田扩展格子',
  farm_upgrade_tier: '灵田等阶突破',
  farm_place_decoration: '灵田放置装饰物',
  altar_summon: '祭坛召唤',
  inventory_sell_item: '背包出售物品',
  tier_up: '灵兽升阶',
  tier_up_auto_buy_pill: '升阶自动购买丹药',
  tier_up_auto_buy_pill_refund: '升阶自动购买丹药退款',
  other: '其他',
};
