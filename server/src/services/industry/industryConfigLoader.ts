/**
 * 百业静态配置加载器。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：从 data/seeds/industry/ 目录加载 6 个 JSON 配置到内存，不写数据库。
 * 2. 不做什么：不做种子 UPSERT、不做热更新、不持久化。
 *
 * 输入 / 输出：
 * - 输入：materials.json / products.json / factories.json / machines.json / recipes.json / puppets.json
 * - 输出：内存缓存，通过 getIndustryConfig() 同步获取。
 *
 * 数据流 / 状态流：
 * 启动时异步加载 → 缓存到内存 → 业务模块同步读取。
 *
 * 关键边界条件与坑点：
 * 1. 文件不存在时返回空数组，不抛错（与 staticConfigLoader 一致）。
 * 2. 配置缓存后不会自动刷新，需要重启服务。
 * 3. 启动顺序：必须在行业调度器启动前调用 initIndustryConfig()。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';

// ── 类型定义 ──

export interface MaterialConfig {
  id: string;
  name: string;
  base_price: number;
  volatility_bps: number;
  min_sell_qty: number;
  price_min: number;
  price_max: number;
  enabled: boolean;
}

export interface ProductConfig {
  id: string;
  name: string;
  base_price: number;
  volatility_bps: number;
  min_sell_qty: number;
  price_min: number;
  price_max: number;
  enabled: boolean;
}

export interface FactoryConfig {
  type: string;
  name: string;
  startup_cost: number;
  max_puppets: number;
}

export interface MachineConfig {
  machine_type: string;
  name: string;
  factory_type: string;
  base_price: number;
  upgrade_cost_multiplier: number;
  output_per_level_bps: number;
  max_upgrade_level: number;
  description: string;
}

export interface RecipeMaterialConfig {
  material_id: string;
  quantity_per_tick: number;
}

export interface RecipeConfig {
  recipe_id: string;
  product_id: string;
  output_per_tick: number;
  min_puppets_per_machine: number;
  allowed_machine_types: string[];
  materials: RecipeMaterialConfig[];
}

export interface PuppetConfig {
  factory_type: string;
  base_cost_per_puppet: number;
  max_puppets: number;
}

// ── 完整配置类型 ──

export interface IndustryConfig {
  materials: readonly MaterialConfig[];
  products: readonly ProductConfig[];
  factories: readonly FactoryConfig[];
  machines: readonly MachineConfig[];
  recipes: readonly RecipeConfig[];
  puppets: readonly PuppetConfig[];
}

// ── 内存缓存 ──

let cachedIndustryConfig: IndustryConfig | null = null;

const SEED_DIR = join(process.cwd(), 'data/seeds/industry');

// ── 通用 JSON 加载器 ──

async function loadJsonFile<T>(filename: string): Promise<T> {
  const content = await readFile(join(SEED_DIR, filename), 'utf-8');
  return JSON.parse(content) as T;
}

// ── 初始化 ──

/**
 * 加载所有百业静态配置（异步，仅内存，不写 DB）。
 */
export async function initIndustryConfig(): Promise<void> {
  try {
    const [materials, products, factories, machines, recipes, puppets] = await Promise.all([
      loadJsonFile<MaterialConfig[]>('materials.json').catch(() => []),
      loadJsonFile<ProductConfig[]>('products.json').catch(() => []),
      loadJsonFile<FactoryConfig[]>('factories.json').catch(() => []),
      loadJsonFile<MachineConfig[]>('machines.json').catch(() => []),
      loadJsonFile<RecipeConfig[]>('recipes.json').catch(() => []),
      loadJsonFile<PuppetConfig[]>('puppets.json').catch(() => []),
    ]);

    cachedIndustryConfig = {
      materials,
      products,
      factories,
      machines,
      recipes,
      puppets,
    };
  } catch {
    cachedIndustryConfig = {
      materials: [],
      products: [],
      factories: [],
      machines: [],
      recipes: [],
      puppets: [],
    };
  }
}

// ── 同步获取 ──

/**
 * 获取完整百业配置。
 * @throws 如果未初始化则抛错。
 */
export function getIndustryConfig(): IndustryConfig {
  if (cachedIndustryConfig === null) {
    throw new Error('Industry config not loaded. Call initIndustryConfig() first.');
  }
  return cachedIndustryConfig;
}

/**
 * 按类型获取工厂配置。
 */
export function getFactoryConfig(type: string): FactoryConfig | undefined {
  return getIndustryConfig().factories.find((f) => f.type === type);
}

/**
 * 按类型获取灵机配置。
 */
export function getMachineConfig(machineType: string): MachineConfig | undefined {
  return getIndustryConfig().machines.find((m) => m.machine_type === machineType);
}

/**
 * 按工厂类型获取傀儡配置。
 */
export function getPuppetConfig(factoryType: string): PuppetConfig | undefined {
  return getIndustryConfig().puppets.find((p) => p.factory_type === factoryType);
}

/**
 * 按 ID 获取配方配置。
 */
export function getRecipeConfig(recipeId: string): RecipeConfig | undefined {
  return getIndustryConfig().recipes.find((r) => r.recipe_id === recipeId);
}

/**
 * 按 ID 获取原材料配置。
 */
export function getMaterialConfig(materialId: string): MaterialConfig | undefined {
  return getIndustryConfig().materials.find((m) => m.id === materialId);
}

/**
 * 按 ID 获取产品配置。
 */
export function getProductConfig(productId: string): ProductConfig | undefined {
  return getIndustryConfig().products.find((p) => p.id === productId);
}
