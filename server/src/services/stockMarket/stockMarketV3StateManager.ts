/**
 * V3 场景状态管理。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：管理场景状态的加载、初始化、切换判定。
 * 2. 不做什么：不定义场景内容、不执行反转引擎、不读写价格表。
 *
 * 输入 / 输出：
 * - 输入：数据库查询结果、tick 计数器。
 * - 输出：当前场景状态、切换决策。
 *
 * 数据流 / 状态流：
 * tick 开始 → loadSceneState() → 无则初始化 → maybeSwitchScene() → 更新状态 → 写入数据库。
 *
 * 复用设计说明：
 * - 场景生命周期逻辑集中在此，V3Service 只调用接口，不重复实现判定逻辑。
 *
 * 关键边界条件与坑点：
 * 1. 首次启动时数据库无场景状态，需要初始化默认场景（scene-peace）。
 * 2. 场景切换时 ticks_elapsed 必须归零。
 * 3. 同一个场景不可连续出现，切换时必须排除 previous_scene_id。
 */

import { query, withTransaction } from '../../config/database.js';
import {
  V3_SCENE_BY_ID,
  V3_SCENE_DEFINITIONS,
  pickNextScene,
  type V3SceneDefinition,
} from './stockMarketV3SceneDefinitions.js';

export type V3SceneStateRow = {
  id: string | number | bigint;
  scene_id: string;
  ticks_elapsed: number;
  previous_scene_id: string | null;
};

export type V3SceneState = {
  scene: V3SceneDefinition;
  ticksElapsed: number;
  previousSceneId: string | null;
};

/** 场景切换概率（min~max tick 之间，每个 tick 的切换概率）。 */
const SCENE_SWITCH_PROBABILITY = 0.2;

/** 从数据库读取场景状态。 */
export const loadSceneState = async (): Promise<V3SceneState | null> => {
  const result = await query<V3SceneStateRow>(
    `
      SELECT id, scene_id, ticks_elapsed, previous_scene_id
      FROM stock_market_v3_scene_state
      LIMIT 1
    `,
  );
  const row = result.rows[0];
  if (!row) return null;

  const scene = V3_SCENE_BY_ID.get(row.scene_id);
  if (!scene) {
    console.error(`[StockMarketV3StateManager] 未知场景 ID: ${row.scene_id}`);
    return null;
  }

  console.log(`[StockMarketV3StateManager] 加载场景: ${scene.id} (${scene.name}), ticksElapsed: ${row.ticks_elapsed}`);
  return {
    scene,
    ticksElapsed: Number(row.ticks_elapsed),
    previousSceneId: row.previous_scene_id,
  };
};

/** 首次启动时初始化场景状态。 */
export const initSceneState = async (defaultSceneId = 'scene-peace'): Promise<V3SceneState> => {
  const scene = V3_SCENE_BY_ID.get(defaultSceneId);
  if (!scene) {
    throw new Error(`V3 默认场景 ${defaultSceneId} 不存在`);
  }
  console.log(`[StockMarketV3StateManager] 初始化场景: ${scene.id} (${scene.name})`);

  await query(
    `
      INSERT INTO stock_market_v3_scene_state (scene_id, ticks_elapsed, previous_scene_id, updated_at)
      VALUES ($1, 0, NULL, NOW())
    `,
    [defaultSceneId],
  );

  return {
    scene,
    ticksElapsed: 0,
    previousSceneId: null,
  };
};

/**
 * 判定是否需要切换场景。
 *
 * @returns null（不切换）或 V3SceneDefinition（切换到的新场景）。
 */
export const maybeSwitchScene = (
  currentState: V3SceneState,
  seed: number,
): V3SceneDefinition | null => {
  const { scene, ticksElapsed } = currentState;

  // 未到最短 tick，不切换
  if (ticksElapsed < scene.minTicks) {
    console.log(`[StockMarketV3StateManager] 场景 ${scene.id} 未达最短 tick (${ticksElapsed}/${scene.minTicks})，不切换`);
    return null;
  }

  // 已达最长 tick，强制切换
  if (ticksElapsed >= scene.maxTicks) {
    const next = pickNextScene(scene.id, seed);
    console.log(`[StockMarketV3StateManager] 场景 ${scene.id} 已达最长 tick (${ticksElapsed} >= ${scene.maxTicks})，强制切换到 ${next.id}`);
    return next;
  }

  // 最短~最长之间，概率切换
  const switchThreshold = Math.floor(seed / 2147483647 * 100);
  const switchPercent = Math.round(SCENE_SWITCH_PROBABILITY * 100);
  if (switchThreshold < switchPercent) {
    const next = pickNextScene(scene.id, seed);
    console.log(`[StockMarketV3StateManager] 场景 ${scene.id} 概率切换 (threshold=${switchThreshold} < ${switchPercent}) → ${next.id}`);
    return next;
  }

  console.log(`[StockMarketV3StateManager] 场景 ${scene.id} 不切换 (threshold=${switchThreshold} >= ${switchPercent})`);
  return null;
};

/** 更新场景状态（tick 结束调用）。 */
export const updateSceneState = async (params: {
  sceneId: string;
  ticksElapsed: number;
  previousSceneId: string | null;
}): Promise<void> => {
  await withTransaction(async () => {
    await query(
      `
        UPDATE stock_market_v3_scene_state
        SET scene_id = $1,
            ticks_elapsed = $2,
            previous_scene_id = $3,
            updated_at = NOW()
        WHERE id = (SELECT id FROM stock_market_v3_scene_state LIMIT 1)
      `,
      [params.sceneId, params.ticksElapsed, params.previousSceneId],
    );
  });
};
