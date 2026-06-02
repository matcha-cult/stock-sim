/**
 * 股市挂单服务。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理玩家限价挂单的创建、取消、查询，以及在每次 AI tick 更新价格后自动撮合成交。
 * 2. 不做什么：不决定股价（由 AI tick 驱动），不重复实现费用计算（复用 stockMarketRules）。
 *
 * 输入 / 输出：
 * - 输入：角色 ID、股票 ID、买卖方向、数量、限价、成交逻辑模式。
 * - 输出：挂单创建/取消结果、活跃挂单列表、撮合执行结果。
 *
 * 数据流 / 状态流：
 * 前端创建挂单 -> 校验（持仓/余额） -> 写入 pending_orders 表；
 * AI tick 更新价格 -> processAllActiveOrders -> 按股票分组 -> 逐单判断成交条件 -> 扣款/加款 + 更新持仓 + 写 trade_record -> 标记 filled。
 *
 * 复用设计说明：
 * - 费用计算复用 calculateStockMarketGrossAmount / calculateStockMarketTradeFee
 * - 资金操作复用 consumeSpiritStones / addSpiritStones
 * - 持仓成本释放复用 calculateReleasedStockHoldingCost
 * - 可卖数量复用 calculateStockMarketMaxSellQuantity
 * - 被 stockMarketService.applyGeneratedTick 撮合调用，也被路由层独立调用
 *
 * 关键边界条件与坑点：
 * 1. 撮合必须在 applyGeneratedTick 的同一事务内执行，保证价格更新和成交原子性。
 * 2. 买入挂单成交时需二次校验余额（创建挂单后余额可能因其他操作变化）。
 * 3. 卖出挂单成交时需二次校验持仓（创建挂单后可能已手动卖出）。
 * 4. FOR UPDATE SKIP LOCKED 防止并发 tick 重复撮合同一挂单。
 */
import { withTransaction, withTransactionAuto, query } from '../../config/database.js';
import { Transactional } from '../../decorators/transactional.js';
import {
  consumeSpiritStones,
  addSpiritStones,
} from '../inventory/shared/consume.js';
import {
  getEnabledStockDefinitionById,
  getEnabledStockDefinitions,
  getEnabledStockIdSet,
  type StockMarketDefinition,
} from './stockMarketDefinitions.js';
import {
  calculateStockMarketGrossAmount,
  calculateStockMarketTradeFee,
  calculateStockMarketMaxSellQuantity,
  calculateReleasedStockHoldingCost,
  stockMarketPriceToStorageUnits,
  stockMarketPriceUnitsToSpiritStones,
  STOCK_MARKET_MIN_PRICE_UNITS,
  STOCK_MARKET_PRICE_SCALE,
  type StockMarketTradeSide,
} from './stockMarketRules.js';

export type PendingOrderSide = 'buy' | 'sell';
export type PendingOrderStatus = 'active' | 'filled' | 'cancelled' | 'expired';
export type PendingOrderTriggerMode = 'normal' | 'premium';

type PendingOrderRow = {
  id: string | number | bigint;
  character_id: number;
  stock_id: string;
  side: string;
  status: string;
  quantity: number | string;
  limit_price_units: string | number | bigint;
  trigger_mode: string;
  created_at: Date | string;
  filled_at: Date | string | null;
  cancelled_at: Date | string | null;
};

export type PendingOrderDto = {
  id: number;
  stockId: string;
  stockName: string;
  stockCode: string;
  side: PendingOrderSide;
  status: PendingOrderStatus;
  quantity: number;
  limitPriceSpiritStones: number;
  frozenSpiritStones: number;
  triggerMode: PendingOrderTriggerMode;
  createdAt: number;
};

type CreateOrderParams = {
  characterId: number;
  stockId: string;
  side: PendingOrderSide;
  quantity: number;
  limitPriceSpiritStones: number;
  triggerMode?: PendingOrderTriggerMode;
};

const toBigIntValue = (value: string | number | bigint | null | undefined): bigint => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim()) return BigInt(value);
  return 0n;
};

const toIntValue = (value: string | number | null | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

const toTimestamp = (value: Date | string): number => {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
};

const toDtoNumber = (value: bigint): number => {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized)) {
    throw new Error('挂单数值超过前端安全整数范围');
  }
  return normalized;
};

const normalizePendingOrderQuantity = (quantity: number): number | null => {
  if (!Number.isInteger(quantity) || quantity <= 0) return null;
  if (!Number.isSafeInteger(quantity)) return null;
  return quantity;
};

class PendingOrderService {
  /**
   * 创建挂单。
   * 买入单校验余额，卖出单校验持仓。
   */
  @Transactional
  async createOrder(params: CreateOrderParams): Promise<{ success: boolean; message: string; orderId?: number }> {
    const definition = getEnabledStockDefinitionById(params.stockId);
    if (!definition) return { success: false, message: '股票不存在' };

    const quantity = normalizePendingOrderQuantity(params.quantity);
    if (quantity === null) return { success: false, message: '挂单数量不合法' };

    const limitPriceUnits = stockMarketPriceToStorageUnits(params.limitPriceSpiritStones);
    if (limitPriceUnits < STOCK_MARKET_MIN_PRICE_UNITS) {
      return { success: false, message: '限价不能低于最小价格' };
    }

    const triggerMode: PendingOrderTriggerMode = params.triggerMode ?? 'normal';
    if (triggerMode !== 'normal' && triggerMode !== 'premium') {
      return { success: false, message: '成交模式不合法' };
    }

    // 卖出单：校验持仓并冻结股票数量
    if (params.side === 'sell') {
      const holdingResult = await query<{ quantity: string | number; frozen_quantity: string | number }>(
        `SELECT quantity, frozen_quantity FROM character_stock_holding WHERE character_id = $1 AND stock_id = $2 FOR UPDATE`,
        [params.characterId, params.stockId],
      );
      const holdingRow = holdingResult.rows[0];
      if (!holdingRow) {
        return { success: false, message: '未持有该股票' };
      }
      const holdingQty = toIntValue(holdingRow.quantity);
      const frozenQty = toIntValue(holdingRow.frozen_quantity ?? 0);
      const availableQty = calculateStockMarketMaxSellQuantity(holdingQty - frozenQty);
      if (quantity > availableQty) {
        return { success: false, message: `可卖持仓不足，当前可卖 ${availableQty} 股` };
      }
      // 冻结股票数量
      await query(
        `
          UPDATE character_stock_holding
          SET frozen_quantity = frozen_quantity + $3,
              updated_at = NOW()
          WHERE character_id = $1 AND stock_id = $2
        `,
        [params.characterId, params.stockId, quantity],
      );
    }

    // 买入单：校验余额并冻结灵石（预估费用按限价计算）
    if (params.side === 'buy') {
      const grossAmount = calculateStockMarketGrossAmount(limitPriceUnits, quantity, 'buy');
      const fee = calculateStockMarketTradeFee(grossAmount, 'buy');
      const totalCost = grossAmount + fee;

      const consumeResult = await consumeSpiritStones(params.characterId, totalCost, {
        bizType: 'pending_create',
        memo: `创建 ${params.side} 挂单 ${params.stockId} x${quantity}`,
      });
      if (!consumeResult.success) {
        return { success: false, message: `灵石不足，预计需要 ${toDtoNumber(totalCost)} 灵石` };
      }
    }

    const now = new Date();

    const insertResult = await query<{ id: string | number | bigint }>(
      `
        INSERT INTO stock_market_pending_order (
          character_id, stock_id, side, status, quantity,
          limit_price_units, trigger_mode, created_at
        )
        VALUES ($1, $2, $3, 'active', $4, $5, $6, $7)
        RETURNING id
      `,
      [
        params.characterId,
        params.stockId,
        params.side,
        quantity,
        limitPriceUnits.toString(),
        triggerMode,
        now,
      ],
    );

    const orderId = toDtoNumber(toBigIntValue(insertResult.rows[0]?.id ?? 0n));
    return { success: true, message: '挂单创建成功', orderId };
  }

  /**
   * 取消挂单。
   * 买入单取消时返还冻结的灵石，卖出单取消时恢复冻结的股票数量。
   */
  @Transactional
  async cancelOrder(orderId: number, characterId: number): Promise<{ success: boolean; message: string }> {
    // 先查出挂单详情，确认属于该角色且处于 active 状态
    const orderResult = await query<PendingOrderRow>(
      `
        SELECT id, character_id, stock_id, side, status, quantity, limit_price_units
        FROM stock_market_pending_order
        WHERE id = $1 AND character_id = $2 AND status = 'active'
        FOR UPDATE
      `,
      [orderId.toString(), characterId],
    );

    if (orderResult.rowCount === 0) {
      return { success: false, message: '挂单不存在或已成交/已取消' };
    }

    const order = orderResult.rows[0];
    const side = order.side as PendingOrderSide;
    const quantity = toIntValue(order.quantity);
    const limitPriceUnits = toBigIntValue(order.limit_price_units);

    // 买入单：返还创建时冻结的灵石
    if (side === 'buy') {
      const grossAmount = calculateStockMarketGrossAmount(limitPriceUnits, quantity, 'buy');
      const fee = calculateStockMarketTradeFee(grossAmount, 'buy');
      const totalCost = grossAmount + fee;
      await addSpiritStones(characterId, totalCost, {
        bizType: 'pending_cancel',
        memo: `取消 ${side} 挂单，返还冻结资金`,
      });
    }

    // 卖出单：恢复创建时冻结的股票数量（仅解冻，quantity 不变）
    if (side === 'sell') {
      const stockId = order.stock_id;
      await query(
        `
          UPDATE character_stock_holding
          SET frozen_quantity = frozen_quantity - $3,
              updated_at = NOW()
          WHERE character_id = $1 AND stock_id = $2
        `,
        [characterId, stockId, quantity],
      );
    }

    // 更新挂单状态
    await query(
      `
        UPDATE stock_market_pending_order
        SET status = 'cancelled', cancelled_at = NOW()
        WHERE id = $1
      `,
      [orderId.toString()],
    );

    return { success: true, message: '挂单已取消' };
  }

  /**
   * 查询用户活跃挂单列表。
   */
  async getActiveOrders(characterId: number): Promise<PendingOrderDto[]> {
    const result = await query<PendingOrderRow>(
      `
        SELECT po.id, po.character_id, po.stock_id, po.side, po.status,
               po.quantity, po.limit_price_units, po.trigger_mode, po.created_at
        FROM stock_market_pending_order po
        WHERE po.character_id = $1 AND po.status = 'active'
        ORDER BY po.created_at DESC
      `,
      [characterId],
    );

    const definitionMap = new Map(
      getEnabledStockDefinitions().map((d) => [d.id, d] as const),
    );

    return result.rows.map((row) => this.buildDto(row, definitionMap));
  }

  /**
   * 撮合所有活跃挂单。
   * 在 applyGeneratedTick 同一事务内调用，传入当前所有股票的最新价格。
   */
  async processAllActiveOrders(): Promise<void> {
    // 获取所有有活跃挂单的股票 ID
    const stockIdsResult = await query<{ stock_id: string }>(
      `SELECT DISTINCT stock_id FROM stock_market_pending_order WHERE status = 'active'`,
      [],
    );
    if (stockIdsResult.rows.length === 0) {
      console.log('[PendingOrder] 无活跃挂单，跳过撮合');
      return;
    }

    const stockIds = stockIdsResult.rows.map((r) => r.stock_id);
    console.log(`[PendingOrder] 发现 ${stockIds.length} 支股票有活跃挂单: ${stockIds.join(', ')}`);

    const enabledStockIdSet = getEnabledStockIdSet();
    const validStockIds = stockIds.filter((id) => enabledStockIdSet.has(id));
    if (validStockIds.length === 0) {
      console.log('[PendingOrder] 所有挂单股票均不在启用列表中，跳过撮合');
      return;
    }

    // 获取这些股票的当前价格
    const quoteResult = await query<{ stock_id: string; current_price_spirit_stones: string | number | bigint }>(
      `SELECT stock_id, current_price_spirit_stones FROM stock_market_quote WHERE stock_id = ANY($1::text[])`,
      [validStockIds],
    );
    const priceMap = new Map<string, bigint>();
    for (const row of quoteResult.rows) {
      priceMap.set(row.stock_id, toBigIntValue(row.current_price_spirit_stones));
    }

    // 逐股票撮合
    for (const stockId of validStockIds) {
      const currentPrice = priceMap.get(stockId);
      if (currentPrice === undefined) {
        console.log(`[PendingOrder] 股票 ${stockId} 缺少报价，跳过`);
        continue;
      }
      console.log(`[PendingOrder] 撮合股票 ${stockId}，当前价格 ${stockMarketPriceUnitsToSpiritStones(currentPrice)}`);
      await this.processOrdersForStock(stockId, currentPrice);
    }
  }

  /**
   * 撮合指定股票的所有活跃挂单。
   * 使用 FOR UPDATE SKIP LOCKED 防止并发重复撮合。
   */
  private async processOrdersForStock(stockId: string, currentPriceUnits: bigint): Promise<void> {
    const ordersResult = await query<PendingOrderRow>(
      `
        SELECT po.* FROM stock_market_pending_order po
        WHERE po.stock_id = $1 AND po.status = 'active'
        ORDER BY po.id ASC
      `,
      [stockId],
    );

    if (ordersResult.rows.length === 0) {
      console.log(`[PendingOrder] 股票 ${stockId} 无活跃挂单`);
      return;
    }

    console.log(`[PendingOrder] 股票 ${stockId} 有 ${ordersResult.rows.length} 笔活跃挂单`);

    const definitionMap = new Map(
      getEnabledStockDefinitions().map((d) => [d.id, d] as const),
    );

    for (const row of ordersResult.rows) {
      await this.tryExecuteOrder(row, currentPriceUnits, definitionMap);
    }
  }

  /**
   * 判断并执行单个挂单的成交逻辑。
   */
  private async tryExecuteOrder(
    order: PendingOrderRow,
    currentPriceUnits: bigint,
    definitionMap: ReadonlyMap<string, StockMarketDefinition>,
  ): Promise<void> {
    const limitPriceUnits = toBigIntValue(order.limit_price_units);
    const side = order.side as PendingOrderSide;
    const triggerMode = order.trigger_mode as PendingOrderTriggerMode;
    const orderId = toBigIntValue(order.id);
    const currentPrice = stockMarketPriceUnitsToSpiritStones(currentPriceUnits);
    const limitPrice = stockMarketPriceUnitsToSpiritStones(limitPriceUnits);

    // 判断是否满足成交条件
    const shouldExecute = this.shouldExecute(side, triggerMode, currentPriceUnits, limitPriceUnits);
    console.log(
      `[PendingOrder] characterId=${order.character_id} 挂单 ${orderId}: ${side} ${triggerMode} 当前价=${currentPrice} 限价=${limitPrice} 成交=${shouldExecute}`,
    );
    if (!shouldExecute) return;

    const characterId = order.character_id;
    const stockId = order.stock_id;
    const quantity = toIntValue(order.quantity);

    try {
      if (side === 'buy') {
        await this.executeBuyOrder(characterId, stockId, quantity, currentPriceUnits, orderId, limitPriceUnits);
        console.log(`[PendingOrder] characterId=${characterId} 挂单 ${orderId} 买入成交，数量=${quantity}`);
      } else {
        await this.executeSellOrder(characterId, stockId, quantity, currentPriceUnits, orderId, definitionMap);
        console.log(`[PendingOrder] characterId=${characterId} 挂单 ${orderId} 卖出成交，数量=${quantity}`);
      }
    } catch (error) {
      console.error(`[PendingOrder] characterId=${characterId} 挂单 ${orderId} 执行失败:`, error);
      // 成交失败不影响其他挂单，继续处理
    }
  }

  /**
   * 判断挂单是否满足成交条件。
   * normal 模式：买入 当前价 <= 挂单价，卖出 当前价 >= 挂单价
   * premium 模式：买入 当前价 >= 挂单价，卖出 当前价 <= 挂单价
   */
  private shouldExecute(
    side: PendingOrderSide,
    triggerMode: PendingOrderTriggerMode,
    currentPriceUnits: bigint,
    limitPriceUnits: bigint,
  ): boolean {
    if (triggerMode === 'premium') {
      return side === 'buy'
        ? currentPriceUnits >= limitPriceUnits
        : currentPriceUnits <= limitPriceUnits;
    }
    // normal 模式
    return side === 'buy'
      ? currentPriceUnits <= limitPriceUnits
      : currentPriceUnits >= limitPriceUnits;
  }

  /**
   * 执行买入挂单成交。
   * 创建挂单时已冻结灵石（限价 gross + 限价 fee），此处按实际成交价计算真实成本，
   * 返还冻结金额与实际成本之间的差额。
   */
  private async executeBuyOrder(
    characterId: number,
    stockId: string,
    quantity: number,
    priceUnits: bigint,
    orderId: bigint,
    limitPriceUnits: bigint,
  ): Promise<void> {
    const grossAmount = calculateStockMarketGrossAmount(priceUnits, quantity, 'buy');
    const fee = calculateStockMarketTradeFee(grossAmount, 'buy');
    const totalCost = grossAmount + fee;

    // 计算创建挂单时冻结的金额（限价 gross + 限价 fee）
    const frozenGross = calculateStockMarketGrossAmount(limitPriceUnits, quantity, 'buy');
    const frozenFee = calculateStockMarketTradeFee(frozenGross, 'buy');
    const frozenTotal = frozenGross + frozenFee;

    // 返还冻结金额与实际成本之间的差额
    if (frozenTotal > totalCost) {
      const refund = frozenTotal - totalCost;
      await addSpiritStones(characterId, refund, {
        bizType: 'pending_fill',
        memo: `挂单成交价优于限价，返还差价`,
      });
    }

    // 更新/创建持仓
    await query(
      `
        INSERT INTO character_stock_holding (
          character_id, stock_id, quantity, total_cost_spirit_stones, updated_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (character_id, stock_id)
        DO UPDATE SET
          quantity = character_stock_holding.quantity + EXCLUDED.quantity,
          total_cost_spirit_stones = character_stock_holding.total_cost_spirit_stones + EXCLUDED.total_cost_spirit_stones,
          updated_at = NOW()
      `,
      [characterId, stockId, quantity, grossAmount.toString()],
    );

    // 写 trade_record
    await this.insertTradeRecord({
      characterId,
      stockId,
      side: 'buy',
      quantity,
      priceUnits,
      grossAmount,
      fee,
      netAmount: totalCost,
      realizedPnl: null,
    });

    // 标记 filled
    await this.markOrderFilled(orderId);
  }

  /**
   * 执行卖出挂单成交。
   * 创建挂单时已冻结股票数量，此处直接解冻并扣减持仓。
   */
  private async executeSellOrder(
    characterId: number,
    stockId: string,
    quantity: number,
    priceUnits: bigint,
    orderId: bigint,
    definitionMap: ReadonlyMap<string, StockMarketDefinition>,
  ): Promise<void> {
    // 获取持仓（创建挂单时已冻结，此处只需解冻并扣减）
    const holdingResult = await query<{
      stock_id: string;
      quantity: string | number;
      frozen_quantity: string | number;
      total_cost_spirit_stones: string | number | bigint;
    }>(
      `SELECT stock_id, quantity, frozen_quantity, total_cost_spirit_stones FROM character_stock_holding
       WHERE character_id = $1 AND stock_id = $2 FOR UPDATE`,
      [characterId, stockId],
    );
    const holding = holdingResult.rows[0];
    if (!holding) {
      await this.markOrderFailed(orderId, '未持有该股票');
      return;
    }

    const holdingQty = toIntValue(holding.quantity);
    const frozenQty = toIntValue(holding.frozen_quantity ?? 0);
    if (quantity > frozenQty) {
      await this.markOrderFailed(orderId, '冻结持仓不足');
      return;
    }
    // 二次校验：防止数据不一致导致持仓被卖成负数（如 frozenQty > holdingQty 的异常状态）
    if (quantity > holdingQty) {
      await this.markOrderFailed(orderId, '实际持仓不足，订单数据异常');
      return;
    }

    const grossAmount = calculateStockMarketGrossAmount(priceUnits, quantity, 'sell');
    const fee = calculateStockMarketTradeFee(grossAmount, 'sell');
    const netAmount = grossAmount > fee ? grossAmount - fee : 0n;
    const holdingCost = toBigIntValue(holding.total_cost_spirit_stones);
    const releasedCost = calculateReleasedStockHoldingCost(holdingCost, holdingQty, quantity);

    // 解冻并扣减持仓
    const remainingFrozen = frozenQty - quantity;
    const remainingQty = holdingQty - quantity;
    if (remainingQty <= 0) {
      // 全部卖出，直接清除
      await query(
        `DELETE FROM character_stock_holding WHERE character_id = $1 AND stock_id = $2`,
        [characterId, stockId],
      );
    } else {
      await query(
        `UPDATE character_stock_holding
         SET quantity = quantity - $3,
             frozen_quantity = frozen_quantity - $3,
             total_cost_spirit_stones = total_cost_spirit_stones - $4,
             updated_at = NOW()
         WHERE character_id = $1 AND stock_id = $2`,
        [characterId, stockId, quantity, releasedCost.toString()],
      );
    }

    const realizedPnl = netAmount - releasedCost;

    // 加款
    if (netAmount > 0n) {
      await addSpiritStones(characterId, netAmount, {
        bizType: 'pending_fill',
        memo: `卖出挂单成交 ${stockId} x${quantity}`,
      });
    }

    // 写 trade_record
    await this.insertTradeRecord({
      characterId,
      stockId,
      side: 'sell',
      quantity,
      priceUnits,
      grossAmount,
      fee,
      netAmount,
      realizedPnl,
    });

    // 标记 filled
    await this.markOrderFilled(orderId);
  }

  private async markOrderFilled(orderId: bigint): Promise<void> {
    await query(
      `UPDATE stock_market_pending_order SET status = 'filled', filled_at = NOW() WHERE id = $1`,
      [orderId.toString()],
    );
  }

  private async markOrderFailed(orderId: bigint, reason: string): Promise<void> {
    console.log(`[PendingOrder] 挂单 ${orderId} 因 ${reason} 标记为取消`);
    await query(
      `UPDATE stock_market_pending_order SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
      [orderId.toString()],
    );
  }

  private async insertTradeRecord(params: {
    characterId: number;
    stockId: string;
    side: 'buy' | 'sell';
    quantity: number;
    priceUnits: bigint;
    grossAmount: bigint;
    fee: bigint;
    netAmount: bigint;
    realizedPnl: bigint | null;
  }): Promise<void> {
    await query(
      `
        INSERT INTO stock_market_trade_record (
          character_id, stock_id, side, quantity, unit_price_spirit_stones,
          gross_amount_spirit_stones, fee_spirit_stones, net_amount_spirit_stones,
          realized_pnl_spirit_stones
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        params.characterId,
        params.stockId,
        params.side,
        params.quantity,
        params.priceUnits.toString(),
        params.grossAmount.toString(),
        params.fee.toString(),
        params.netAmount.toString(),
        params.realizedPnl === null ? null : params.realizedPnl.toString(),
      ],
    );
  }

  private buildDto(
    row: PendingOrderRow,
    definitionMap: ReadonlyMap<string, StockMarketDefinition>,
  ): PendingOrderDto {
    const definition = definitionMap.get(row.stock_id);
    const limitPriceUnits = toBigIntValue(row.limit_price_units);
    const priceSpiritStones = stockMarketPriceUnitsToSpiritStones(limitPriceUnits);
    const quantity = toIntValue(row.quantity);
    const side = row.side as StockMarketTradeSide;

    // 计算冻结金额：买入 = gross + fee，卖出 = gross（冻结股票按限价的等价价值）
    const grossAmount = calculateStockMarketGrossAmount(limitPriceUnits, quantity, side);
    const fee = calculateStockMarketTradeFee(grossAmount, side);
    const frozenSpiritStones = side === 'buy'
      ? Number(grossAmount + fee)
      : Number(grossAmount);

    return {
      id: toDtoNumber(toBigIntValue(row.id)),
      stockId: row.stock_id,
      stockName: definition?.name ?? row.stock_id,
      stockCode: definition?.code ?? row.stock_id,
      side: row.side as PendingOrderSide,
      status: row.status as PendingOrderStatus,
      quantity,
      limitPriceSpiritStones: priceSpiritStones,
      frozenSpiritStones,
      triggerMode: row.trigger_mode as PendingOrderTriggerMode,
      createdAt: toTimestamp(row.created_at),
    };
  }
}

export const pendingOrderService = new PendingOrderService();
