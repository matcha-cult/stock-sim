/**
 * 股市 V3 驱动器入口（场景轮换 + 反转 + 叙事轨迹）。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：实现与 V1 相同的 runScheduledTick 入口，按场景预设涨跌因子生成行情。
 * 2. 不做什么：不读写 V1 内部表（news_event、event 状态机）。
 *
 * 输入 / 输出：
 * - 输入：调度时间 now。
 * - 输出：与 V1 一致的 { status, message } 结构。
 *
 * 数据流 / 状态流：
 * ① INSERT v3_tick → ② SELECT quote → ③ loadSceneState → ④ maybeSwitchScene
 * → ⑤ applyTwists → ⑥ loadNarrativeTrail → ⑦ generateV3AiNewsDraft
 * → ⑧ applyGeneratedV3Tick → ⑨ processAllActiveOrders
 *
 * 复用设计说明：
 * - 入口签名与 V1 一致，调度层无需感知驱动器差异。
 * - 共享输出表（stock_market_quote、stock_market_price_history），前端无需改动。
 * - AI 调用复用 callConfiguredTextModel，价格计算复用 applyStockMarketPriceChange。
 *
 * 关键边界条件与坑点：
 * 1. 首次启动时初始化场景状态（scene-peace）。
 * 2. 未受 AI 影响的股票仍需更新价格（随机噪声或买卖压力），否则前端 K 线断档。
 * 3. FOR UPDATE 行锁保证并发安全（虽然运行时只有一个驱动器活跃）。
 */

import { query, withTransaction } from '../../config/database.js';
import { generateTechniqueTextModelSeed } from '../shared/techniqueTextModelShared.js';
import {
  getEnabledStockDefinitions,
  getEnabledStockIdSet,
  type StockMarketDefinition,
} from './stockMarketDefinitions.js';
import {
  applyStockMarketPriceChange,
  generateStockMarketNoiseChangeBps,
  calculateStockMarketPressureChangeBps,
  isStockMarketNoiseEnabled,
  stockMarketPriceUnitsToSpiritStones,
} from './stockMarketRules.js';
import { STOCK_MARKET_SCENARIO_RECENT_TICK_LIMIT } from './stockMarketScenarioSelector.js';
import { pendingOrderService } from './pendingOrderService.js';
import { floorStockMarketTickTime } from './stockMarketTime.js';
import {
  validateV3SceneDefinitions,
  V3_SCENE_BY_ID,
  type V3SceneDefinition,
} from './stockMarketV3SceneDefinitions.js';
import {
  loadSceneState,
  initSceneState,
  maybeSwitchScene,
  updateSceneState,
  type V3SceneState,
} from './stockMarketV3StateManager.js';
import { loadNarrativeTrail } from './stockMarketV3NarrativeTrail.js';
import { maybeTriggerTwists } from './stockMarketV3TwistEngine.js';
import {
  generateStockMarketV3AiNewsDraft,
  type V3StockDirectionEntry,
  type V3ValidatedImpact,
} from './stockMarketV3Ai.js';

export type StockMarketV3TickResult = {
  status: 'generated' | 'failed' | 'skipped';
  message: string;
};

// ==================== 内部类型 ====================

type V3QuoteRow = {
  stock_id: string;
  current_price_spirit_stones: string | number | bigint;
  last_change_bps: number;
};

type V3TickInsertRow = {
  id: string | number | bigint;
};

const toBigIntValue = (value: string | number | bigint | null | undefined): bigint => {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim()) return BigInt(value);
  return 0n;
};

const buildStockMarketDirection = (changeBps: number): string => {
  if (changeBps > 0) return 'up';
  if (changeBps < 0) return 'down';
  return 'flat';
};

const STOCK_MARKET_NOISE_REASON = '市场正常起伏';
const STOCK_MARKET_PRESSURE_REASON = '买卖压力';

// ==================== V3 服务 ====================

class StockMarketV3Service {
  async runScheduledTick(now: Date = new Date()): Promise<StockMarketV3TickResult> {
    // 启动时校验场景定义完整性
    const validationError = validateV3SceneDefinitions();
    if (validationError) {
      console.error('[StockMarketV3] 场景定义校验失败:', validationError);
      return { status: 'failed', message: `V3 场景定义校验失败: ${validationError}` };
    }
    console.log('[StockMarketV3] 场景定义校验通过');

    // ① INSERT stock_market_v3_tick
    const tickHour = floorStockMarketTickTime(now);
    console.log('[StockMarketV3] ① 创建 tick, tickHour:', tickHour.toISOString());

    // 先 SELECT 检查当前 tickHour 是否已有记录，
    // 避免依赖 ON CONFLICT 做正常分支判断。
    const existingResult = await query<{ id: string | number | bigint; status: string }>(
      `SELECT id, status FROM stock_market_v3_tick WHERE tick_hour = $1`,
      [tickHour],
    );
    const existingTick = existingResult.rows[0];
    if (existingTick) {
      if (existingTick.status === 'generated') {
        return { status: 'skipped', message: `V3 tick ${tickHour.toISOString()} 已存在且已生成，跳过` };
      }
      if (existingTick.status === 'running') {
        return { status: 'skipped', message: `V3 tick ${tickHour.toISOString()} 正在执行中，跳过` };
      }
      return { status: 'skipped', message: `V3 tick ${tickHour.toISOString()} 状态异常（${existingTick.status}），跳过` };
    }

    const insertResult = await query<V3TickInsertRow>(
      `
        INSERT INTO stock_market_v3_tick (tick_hour, status, created_at)
        VALUES ($1, 'running', $2)
        ON CONFLICT (tick_hour) DO NOTHING
        RETURNING id
      `,
      [tickHour, now],
    );
    const insertedTick = insertResult.rows[0];
    if (!insertedTick) {
      return { status: 'skipped', message: `V3 tick ${tickHour.toISOString()} 已被其他进程创建，跳过` };
    }
    const tickId = toBigIntValue(insertedTick.id);
    console.log('[StockMarketV3] ① tick 创建成功, tickId:', tickId.toString());

    // ② SELECT stock_market_quote
    const definitions = getEnabledStockDefinitions();
    const allStockIds = definitions.map((d) => d.id);
    console.log('[StockMarketV3] ② 读取报价, 股票数:', allStockIds.length);
    const quoteResult = await query<V3QuoteRow>(
      `
        SELECT stock_id, current_price_spirit_stones, last_change_bps
        FROM stock_market_quote
        WHERE stock_id = ANY($1::text[])
      `,
      [allStockIds],
    );
    const quotes = quoteResult.rows.map((row) => ({
      stockId: row.stock_id,
      currentPriceUnits: toBigIntValue(row.current_price_spirit_stones),
    }));

    // ③ loadSceneState
    console.log('[StockMarketV3] ③ 加载场景状态');
    let sceneState: V3SceneState | null = await loadSceneState();
    if (!sceneState) {
      console.log('[StockMarketV3] ③ 首次启动，初始化默认场景 scene-peace');
      sceneState = await initSceneState();
    } else {
      console.log(`[StockMarketV3] ③ 当前场景: ${sceneState.scene.id}, 已运行: ${sceneState.ticksElapsed} ticks`);
    }

    // ④ maybeSwitchScene
    const seed = generateTechniqueTextModelSeed();
    console.log('[StockMarketV3] ④ 判定场景切换, seed:', seed);
    const nextScene = maybeSwitchScene(sceneState, seed);
    if (nextScene) {
      console.log(`[StockMarketV3] ④ 切换场景: ${sceneState.scene.id} → ${nextScene.id}`);
      sceneState = {
        scene: nextScene,
        ticksElapsed: 0,
        previousSceneId: sceneState.scene.id,
      };
    } else {
      console.log(`[StockMarketV3] ④ 场景不变: ${sceneState.scene.id}, 已运行: ${sceneState.ticksElapsed + 1}/${sceneState.scene.maxTicks}`);
    }

    // ⑤ applyTwists → 构建涨跌因子
    const stockDirections = this.buildStockDirections(sceneState.scene);
    const activeTwists = maybeTriggerTwists(sceneState.scene, seed);
    this.applyTwistsToDirections(stockDirections, activeTwists);
    console.log(`[StockMarketV3] ⑤ 涨跌因子: ${stockDirections.length} 只股票`);
    console.log(`[StockMarketV3] ⑤ 反转触发: ${activeTwists.length} 条`);
    if (activeTwists.length > 0) {
      for (const t of activeTwists) {
        console.log(`[StockMarketV3] ⑤ 反转: ${t.stockId} → ${t.directionOverride} (${t.narrativeReason})`);
      }
    }

    // 打印涨跌方向摘要
    for (const d of stockDirections) {
      const twistTag = d.narrativeTwist ? ' [反转]' : '';
      console.log(`[StockMarketV3] ⑤ ${d.stockId}: ${d.direction} (强度${d.strength})${twistTag} - ${d.reason}`);
    }

    // ⑥ loadNarrativeTrail
    const narrativeTrail = await loadNarrativeTrail();
    console.log(`[StockMarketV3] ⑥ 叙事轨迹: ${narrativeTrail.length} 条`);

    // ⑦ generateV3AiNewsDraft
    console.log('[StockMarketV3] ⑦ 调用 AI 生成新闻');
    const newsResult = await generateStockMarketV3AiNewsDraft({
      definitions,
      quotes,
      tickHour,
      scene: sceneState.scene,
      ticksElapsed: sceneState.ticksElapsed,
      stockDirections,
      narrativeTrail,
    });

    if (!newsResult.success) {
      console.error('[StockMarketV3] ⑦ AI 新闻生成失败:', newsResult.reason);
      await this.recordV3TickFailure(tickId, newsResult.reason);
      return { status: 'failed', message: newsResult.reason };
    }
    console.log(`[StockMarketV3] ⑦ AI 新闻生成成功: "${newsResult.draft.headline}"`);
    console.log(`[StockMarketV3] ⑦ 影响股票: ${newsResult.draft.impacts.length} 只`);
    for (const impact of newsResult.draft.impacts) {
      console.log(`[StockMarketV3] ⑦ ${impact.stockId}: ${impact.changeBps > 0 ? '+' : ''}${impact.changeBps} bps - ${impact.reason}`);
    }

    // ⑧ applyGeneratedV3Tick
    console.log('[StockMarketV3] ⑧ 写入 tick + 价格');
    await this.applyGeneratedV3Tick({
      tickId,
      tickHour,
      sceneId: sceneState.scene.id,
      headline: newsResult.draft.headline,
      summary: newsResult.draft.summary,
      modelName: newsResult.draft.modelName,
      promptSnapshot: newsResult.draft.promptSnapshot,
      impacts: newsResult.draft.impacts,
      activeTwists,
      narrativeTrail,
      allStockIds,
      definitions,
      quotes,
    });
    console.log('[StockMarketV3] ⑧ 写入完成');

    // ⑨ 更新场景状态
    await updateSceneState({
      sceneId: sceneState.scene.id,
      ticksElapsed: sceneState.ticksElapsed + 1,
      previousSceneId: sceneState.previousSceneId,
    });
    console.log(`[StockMarketV3] ⑨ 场景状态更新: ${sceneState.scene.id}, ticksElapsed: ${sceneState.ticksElapsed + 1}`);

    return { status: 'generated', message: `V3 场景「${sceneState.scene.name}」行情已生成` };
  }

  /** 根据场景定义构建每只股票的涨跌因子。 */
  private buildStockDirections(scene: V3SceneDefinition): V3StockDirectionEntry[] {
    return scene.baseDirections.map((d) => ({
      stockId: d.stockId,
      direction: d.direction,
      strength: d.strength,
      reason: d.reason,
    }));
  }

  /** 将反转覆盖到涨跌因子上。 */
  private applyTwistsToDirections(
    directions: V3StockDirectionEntry[],
    twists: Array<{ stockId: string; directionOverride: 'bullish' | 'bearish'; strengthOverride: number; narrativeReason: string }>,
  ): void {
    const directionMap = new Map(directions.map((d) => [d.stockId, d]));
    for (const twist of twists) {
      const entry = directionMap.get(twist.stockId);
      if (entry) {
        entry.direction = twist.directionOverride;
        entry.strength = twist.strengthOverride;
        entry.reason = twist.narrativeReason;
        entry.narrativeTwist = true;
        entry.twistReason = twist.narrativeReason;
      }
    }
  }

  /** 记录 tick 失败。 */
  private async recordV3TickFailure(tickId: bigint, errorMessage: string): Promise<void> {
    await query(
      `
        UPDATE stock_market_v3_tick
        SET status = 'failed',
            error_message = $2,
            finished_at = NOW()
        WHERE id = $1
      `,
      [tickId.toString(), errorMessage],
    );
  }

  /** 事务写入 V3 tick + 价格。 */
  private async applyGeneratedV3Tick(params: {
    tickId: bigint;
    tickHour: Date;
    sceneId: string;
    headline: string;
    summary: string;
    modelName: string;
    promptSnapshot: string;
    impacts: V3ValidatedImpact[];
    activeTwists: Array<{ stockId: string; directionOverride: string; strengthOverride: number; narrativeReason: string }>;
    narrativeTrail: Array<{ tickId: string; hour: string; headline: string | null; summary: string | null; impacts: Array<{ stockId: string; changeBps: number; direction: string }> }>;
    allStockIds: readonly string[];
    definitions: readonly StockMarketDefinition[];
    quotes: Array<{ stockId: string; currentPriceUnits: bigint }>;
  }): Promise<void> {
    await withTransaction(async () => {
      // 确认 tick 状态
      const tickResult = await query<{ id: string | number | bigint; status: string }>(
        `SELECT id, status FROM stock_market_v3_tick WHERE id = $1 FOR UPDATE`,
        [params.tickId.toString()],
      );
      if (tickResult.rows[0]?.status !== 'running') {
        console.log(`[StockMarketV3] tick ${params.tickId} 状态不是 running (${tickResult.rows[0]?.status})，跳过`);
        return;
      }

      // 更新 tick 状态
      await query(
        `
          UPDATE stock_market_v3_tick
          SET status = 'generated',
              scene_id = $2,
              headline = $3,
              summary = $4,
              model_name = $5,
              prompt_snapshot = $6,
              active_twists = $7,
              narrative_trail = $8,
              finished_at = NOW()
          WHERE id = $1
        `,
        [
          params.tickId.toString(),
          params.sceneId,
          params.headline,
          params.summary,
          params.modelName,
          params.promptSnapshot,
          JSON.stringify(params.activeTwists),
          JSON.stringify(params.narrativeTrail),
        ],
      );

      // 锁定并更新 AI 影响的股票
      const impactedStockIds = params.impacts.map((i) => i.stockId);
      console.log(`[StockMarketV3] 锁定 ${impactedStockIds.length} 只 AI 影响股票`);
      const impactedQuotes = await this.loadQuoteRowsForUpdate(impactedStockIds);
      if (impactedQuotes.size !== impactedStockIds.length) {
        console.error('[StockMarketV3] AI 新闻包含缺失报价的股票');
        await this.recordV3TickFailure(params.tickId, 'AI 新闻包含缺失报价的股票');
        return;
      }

      for (const impact of params.impacts) {
        const quote = impactedQuotes.get(impact.stockId);
        if (!quote) continue;
        const currentPrice = toBigIntValue(quote.current_price_spirit_stones);
        const changeBps = impact.changeBps;
        const nextPrice = applyStockMarketPriceChange(currentPrice, changeBps);
        const direction = buildStockMarketDirection(changeBps);
        const oldPrice = stockMarketPriceUnitsToSpiritStones(currentPrice).toFixed(2);
        const newPrice = stockMarketPriceUnitsToSpiritStones(nextPrice).toFixed(2);
        console.log(`[StockMarketV3] ${impact.stockId}: ${oldPrice} → ${newPrice} (${changeBps > 0 ? '+' : ''}${changeBps} bps, ${direction})`);

        await query(
          `
            UPDATE stock_market_quote
            SET current_price_spirit_stones = $2,
                last_change_bps = $3,
                last_tick_id = $4,
                updated_at = NOW()
            WHERE stock_id = $1
          `,
          [impact.stockId, nextPrice.toString(), changeBps, params.tickId.toString()],
        );

        await query(
          `
            INSERT INTO stock_market_price_history (
              stock_id, tick_id, price_spirit_stones, change_bps, direction, reason, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            impact.stockId,
            params.tickId.toString(),
            nextPrice.toString(),
            changeBps,
            direction,
            impact.reason,
            params.tickHour,
          ],
        );
      }

      // 未受影响的股票：随机噪声或买卖压力
      const impactedStockIdSet = new Set(impactedStockIds);
      const unimpactedStockIds = params.allStockIds.filter((id) => !impactedStockIdSet.has(id));
      console.log(`[StockMarketV3] 未受影响股票: ${unimpactedStockIds.length} 只`);
      if (unimpactedStockIds.length > 0) {
        const unimpactedQuotes = await this.loadQuoteRowsForUpdate(unimpactedStockIds);
        const pressureMap = await this.getTradePressureMap(unimpactedStockIds, params.tickId, 10);
        const tickIdNum = Number(params.tickId);
        let noiseCount = 0;
        let pressureCount = 0;

        for (const stockId of unimpactedStockIds) {
          const quote = unimpactedQuotes.get(stockId);
          if (!quote) continue;
          const currentPrice = toBigIntValue(quote.current_price_spirit_stones);

          const pressure = pressureMap.get(stockId);
          const totalVolume = pressure ? pressure.buyQty + pressure.sellQty : 0;

          let changeBps: number;
          let reason: string;

          if (totalVolume === 0) {
            changeBps = isStockMarketNoiseEnabled()
              ? generateStockMarketNoiseChangeBps(tickIdNum, stockId, params.tickHour)
              : 0;
            reason = STOCK_MARKET_NOISE_REASON;
          } else {
            changeBps = calculateStockMarketPressureChangeBps(
              pressure!.buyQty,
              pressure!.sellQty,
              stockId,
              tickIdNum,
            );
            reason = STOCK_MARKET_PRESSURE_REASON;
            pressureCount++;
          }

          if (changeBps === 0) continue;

          const nextPrice = applyStockMarketPriceChange(currentPrice, changeBps);
          const direction = buildStockMarketDirection(changeBps);
          noiseCount++;

          await query(
            `
              UPDATE stock_market_quote
              SET current_price_spirit_stones = $2,
                  last_change_bps = $3,
                  last_tick_id = $4,
                  updated_at = NOW()
              WHERE stock_id = $1
            `,
            [stockId, nextPrice.toString(), changeBps, params.tickId.toString()],
          );

          await query(
            `
              INSERT INTO stock_market_price_history (
                stock_id, tick_id, price_spirit_stones, change_bps, direction, reason, created_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `,
            [stockId, params.tickId.toString(), nextPrice.toString(), changeBps, direction, reason, params.tickHour],
          );
        }
        console.log(`[StockMarketV3] 噪声更新: ${noiseCount} 只, 买卖压力: ${pressureCount} 只`);
      }
    });

    // ⑩ 撮合挂单（事务外）
    console.log('[StockMarketV3] ⑩ 撮合挂单');
    await pendingOrderService.processAllActiveOrders();
  }

  /** 锁定报价行 FOR UPDATE。 */
  private async loadQuoteRowsForUpdate(stockIds: string[]): Promise<Map<string, V3QuoteRow>> {
    if (stockIds.length === 0) return new Map();
    const result = await query<V3QuoteRow>(
      `
        SELECT stock_id, current_price_spirit_stones, last_change_bps
        FROM stock_market_quote
        WHERE stock_id = ANY($1::text[])
        FOR UPDATE
      `,
      [stockIds],
    );
    const map = new Map<string, V3QuoteRow>();
    for (const row of result.rows) {
      map.set(row.stock_id, row);
    }
    return map;
  }

  /** 查询买卖压力映射（复用 V1 逻辑）。 */
  private async getTradePressureMap(
    stockIds: string[],
    tickId: bigint,
    lookbackTicks: number,
  ): Promise<Map<string, { buyQty: number; sellQty: number }>> {
    if (stockIds.length === 0) return new Map();

    const result = await query<{ stock_id: string; buy_qty: string | number; sell_qty: string | number }>(
      `
        SELECT stock_id,
               COALESCE(SUM(quantity) FILTER (WHERE side = 'buy'), 0)::int AS buy_qty,
               COALESCE(SUM(quantity) FILTER (WHERE side = 'sell'), 0)::int AS sell_qty
        FROM stock_market_trade_record
        WHERE stock_id = ANY($1::text[])
          AND created_at >= (
            SELECT created_at
            FROM stock_market_v3_tick
            WHERE status = 'generated'
            ORDER BY tick_hour DESC
            LIMIT 1 OFFSET $2
          )
        GROUP BY stock_id
      `,
      [stockIds, lookbackTicks],
    );

    const map = new Map<string, { buyQty: number; sellQty: number }>();
    for (const row of result.rows) {
      map.set(row.stock_id, {
        buyQty: Number(row.buy_qty),
        sellQty: Number(row.sell_qty),
      });
    }
    return map;
  }

  /** V3 新闻事件列表查询（映射为 V1 NewsEventDto 格式，前端无需改动）。 */
  async getNewsEventList(): Promise<Array<{
    id: string;
    status: string;
    theme: string | null;
    headline: string | null;
    summary: string | null;
    stage: string | null;
    affectedStockIds: string[];
    startedTickId: string | null;
    lastTickId: string | null;
    continuationCount: number;
    lastContinuedAt: number | null;
  }>> {
    const result = await query<{
      id: string | number | bigint;
      tick_hour: Date | string;
      headline: string | null;
      summary: string | null;
      scene_id: string | null;
    }>(
      `
        SELECT id, tick_hour, headline, summary, scene_id
        FROM stock_market_v3_tick
        WHERE status = 'generated'
        ORDER BY tick_hour DESC
        LIMIT 50
      `,
    );

    // 批量查询每个 tick 的影响股票
    const tickIds = result.rows.map((r) => toBigIntValue(r.id).toString());
    let impactsByTickId = new Map<string, string[]>();
    if (tickIds.length > 0) {
      const historyResult = await query<{ tick_id: string | number | bigint; stock_id: string }>(
        `SELECT tick_id, stock_id FROM stock_market_price_history WHERE tick_id = ANY($1::bigint[]) AND reason != $2`,
        [tickIds, STOCK_MARKET_NOISE_REASON],
      );
      impactsByTickId = new Map<string, string[]>();
      for (const row of historyResult.rows) {
        const tid = toBigIntValue(row.tick_id).toString();
        const list = impactsByTickId.get(tid);
        if (list) {
          list.push(row.stock_id);
        } else {
          impactsByTickId.set(tid, [row.stock_id]);
        }
      }
    }

    return result.rows.map((r) => {
      const tid = toBigIntValue(r.id).toString();
      return {
        id: tid,
        status: 'resolved' as const,
        theme: r.scene_id,
        headline: r.headline,
        summary: r.summary,
        stage: 'completed' as const,
        affectedStockIds: impactsByTickId.get(tid) ?? [],
        startedTickId: tid,
        lastTickId: tid,
        continuationCount: 0,
        lastContinuedAt: new Date(r.tick_hour).getTime(),
      };
    });
  }

  /** V3 新闻详情查询（映射为 V1 NewsEventChainDto 格式，前端无需改动）。 */
  async getNewsEventChain(tickId: string): Promise<{
    event: {
      id: string;
      status: string;
      theme: string | null;
      headline: string | null;
      summary: string | null;
      stage: string | null;
      affectedStockIds: string[];
      startedTickId: string | null;
      lastTickId: string | null;
    };
    ticks: Array<{
      tickId: string;
      tickHour: number;
      headline: string;
      summary: string;
      status: string;
      impacts: Array<{ stockId: string; stockName: string; changeBps: number; direction: string; reason: string | null }>;
    }>;
  } | null> {
    const tickResult = await query<{
      id: string | number | bigint;
      tick_hour: Date | string;
      headline: string | null;
      summary: string | null;
      scene_id: string | null;
      status: string;
    }>(
      `SELECT id, tick_hour, headline, summary, scene_id, status FROM stock_market_v3_tick WHERE id = $1`,
      [tickId],
    );
    const tickRow = tickResult.rows[0];
    if (!tickRow || !tickRow.headline) return null;

    const tid = toBigIntValue(tickRow.id).toString();

    const historyResult = await query<{
      stock_id: string;
      change_bps: number;
      direction: string;
      reason: string | null;
    }>(
      `SELECT stock_id, change_bps, direction, reason FROM stock_market_price_history WHERE tick_id = $1 AND reason != $2`,
      [tid, STOCK_MARKET_NOISE_REASON],
    );

    const definitionMap = new Map(getEnabledStockDefinitions().map((d) => [d.id, d] as const));
    const impacts = historyResult.rows.map((r) => ({
      stockId: r.stock_id,
      stockName: definitionMap.get(r.stock_id)?.name ?? r.stock_id,
      changeBps: Number(r.change_bps),
      direction: r.direction,
      reason: r.reason,
    }));

    return {
      event: {
        id: tid,
        status: 'resolved',
        theme: tickRow.scene_id,
        headline: tickRow.headline,
        summary: tickRow.summary,
        stage: 'completed',
        affectedStockIds: impacts.map((i) => i.stockId),
        startedTickId: tid,
        lastTickId: tid,
      },
      ticks: [{
        tickId: tid,
        tickHour: new Date(tickRow.tick_hour).getTime(),
        headline: tickRow.headline,
        summary: tickRow.summary!,
        status: tickRow.status,
        impacts,
      }],
    };
  }
}

export const stockMarketV3Service = new StockMarketV3Service();
