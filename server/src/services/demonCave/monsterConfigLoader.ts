/**
 * 怪物清单加载器（锁妖窟用）
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：从 data/seeds/demonCave/monsters/ 目录加载怪物物种定义 JSON，构建 Map 索引，提供同步 O(1) 查询。
 * 2. 不做什么：不做数据库同步、不做热更新、不持久化。
 *
 * 数据流 / 状态流：
 * 启动时异步加载目录所有 JSON → 校验 id 唯一性 → 构建 Map 索引 → 缓存到内存 → 业务模块同步读取。
 *
 * 复用设计说明：
 * - 与 itemConfigLoader / farmConfigLoader / beastConfigLoader 同模式。
 * - Map 索引 O(1) vs O(n) 查询。
 * - 启动即校验，不静默降级。
 *
 * 关键边界条件与坑点：
 * 1. 文件不存在 / JSON 格式错误时直接抛错，启动失败。
 * 2. 必须在应用启动时调用 initDemonCaveMonsterConfig()。
 * 3. id 必须全局唯一，重复时启动报错。
 * 4. 怪物定义引用模板（template_id），不再包含硬编码属性。
 */
import { readFile, readdir } from 'fs/promises';
import { join } from 'path';

// ==================== 类型定义 ====================

export interface MonsterDefConfig {
  id: string;
  name: string;
  description: string;
  template_id: string; // 引用怪物模板
  element: string[];
}

// ==================== 内存缓存 ====================

let monsterById: Map<string, MonsterDefConfig> | null = null;
let allMonsters: MonsterDefConfig[] | null = null;

const SEED_DIR = join(process.cwd(), 'data/seeds/demonCave/monsters');

// ==================== 初始化 ====================

export const initDemonCaveMonsterConfig = async (): Promise<void> => {
  const files = (await readdir(SEED_DIR)).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    throw new Error(`[monsterConfigLoader] 怪物种子目录为空: ${SEED_DIR}`);
  }

  const definitions: MonsterDefConfig[] = [];
  for (const file of files) {
    const content = await readFile(join(SEED_DIR, file), 'utf-8');
    const def = JSON.parse(content) as MonsterDefConfig;
    definitions.push(def);
  }

  // 校验 id 唯一性
  const idSet = new Set<string>();
  for (const def of definitions) {
    if (!def.id) {
      throw new Error(`[monsterConfigLoader] 怪物缺少 id 字段: ${JSON.stringify(def)}`);
    }
    if (idSet.has(def.id)) {
      throw new Error(`[monsterConfigLoader] 怪物 id 重复: ${def.id}`);
    }
    idSet.add(def.id);

    // 校验 template_id 存在性
    if (!def.template_id) {
      throw new Error(`[monsterConfigLoader] 怪物缺少 template_id 字段: ${def.id}`);
    }
  }

  // 构建 Map 索引
  monsterById = new Map(definitions.map((m) => [m.id, m]));
  allMonsters = definitions;

  console.log(`[monsterConfigLoader] 加载完成: ${allMonsters.length} 个怪物定义`);
};

// ==================== 查询接口 ====================

const ensureLoaded = (): void => {
  if (!monsterById || !allMonsters) {
    throw new Error('[monsterConfigLoader] 未初始化，请先调用 initDemonCaveMonsterConfig()');
  }
};

export const getDemonCaveMonsterDefinitions = (): MonsterDefConfig[] => {
  ensureLoaded();
  return allMonsters!;
};

export const getDemonCaveMonsterById = (id: string): MonsterDefConfig | null => {
  ensureLoaded();
  return monsterById!.get(id) ?? null;
};
