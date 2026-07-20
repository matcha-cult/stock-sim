/**
 * 统一背包系统 — 全量迁移脚本。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：
 *    a. 从 seeds.json + crops.json 生成完整物品定义并写入 item_definitions。
 *    b. 将 farm_seed_inventory 数据迁移到 inventory_items。
 *    c. 将 farm_harvest_inventory 数据迁移到 inventory_items。
 * 2. 不做什么：不删除旧表（保留作为备份）。
 *
 * 数据流 / 状态流：
 * 读取 JSON 种子数据 → 生成 item_definitions → 批量插入 → 读取旧表 → 调用 addItem → 完成。
 *
 * 关键边界条件与坑点：
 * 1. 旧种子表 item_id 已带 seed_ 前缀，与新 item_key 一致，直接映射。
 * 2. 旧灵材表 crop_id 不带前缀，需要加 material_ 前缀映射到新 item_key。
 * 3. item_definitions 使用 ON CONFLICT DO NOTHING，重复执行安全。
 * 4. inventory_items 使用 addItem 的 ON CONFLICT DO UPDATE 实现增量合并。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { query } from '../src/config/database.js';
import { addItem } from '../src/services/inventory/unifiedInventoryService.js';
import { initItemConfig } from '../src/services/inventory/itemConfigLoader.js';

interface SeedRaw {
  itemId: string;
  cropId: string;
  name: string;
  description: string;
  buyPrice: number;
  sellPrice: number;
  maxStack: number;
  requiredTier: number;
  seedUnit: string;
}

interface CropRaw {
  cropId: string;
  name: string;
  description: string;
  rarity: string;
  sellPricePerUnit: number;
  harvestTradeUnit: number;
  harvestUnit: string;
  seedItemId: string;
}

/** 根据 cropId 推断 subcategory */
const deriveSubcategory = (cropId: string): string => {
  if (cropId.startsWith('spirit_root')) return 'spirit_root';
  if (cropId.includes('rice') || cropId.startsWith('rice')) return 'grain';
  if (cropId.includes('hu') || cropId === 'ling_hu') return 'gourd';
  if (cropId.includes('lian') || cropId === 'ling_lian') return 'lotus';
  return 'herb';
};

/**
 * 归一化稀有度：系统支持 天地玄黄 四阶（降序：天 > 地 > 玄 > 黄）。
 * 对应内部值：legendary(天) / rare(地) / uncommon(玄) / common(黄)。
 * 未知值默认回退 common。
 */
const normalizeRarity = (raw: string): string => {
  if (raw === 'legendary' || raw === 'rare' || raw === 'uncommon' || raw === 'common') return raw;
  return 'common';
};

async function populateItemDefinitions(): Promise<void> {
  console.log('[步骤1] 从 seeds.json + crops.json 生成物品定义...');

  const seedsPath = join(process.cwd(), 'data/seeds/farm/seeds.json');
  const cropsPath = join(process.cwd(), 'data/seeds/farm/crops.json');

  const seedsRaw = JSON.parse(await readFile(seedsPath, 'utf-8')) as { seeds: SeedRaw[] };
  const cropsRaw = JSON.parse(await readFile(cropsPath, 'utf-8')) as { crops: CropRaw[] };

  // 建立 cropId → rarity 索引
  const cropRarityMap = new Map<string, string>();
  for (const crop of cropsRaw.crops) {
    cropRarityMap.set(crop.cropId, crop.rarity);
  }

  let insertCount = 0;
  let skipCount = 0;

  // 插入种子定义
  for (const seed of seedsRaw.seeds) {
    const cropRarity = cropRarityMap.get(seed.cropId) ?? 'common';
    const result = await query(
      `INSERT INTO item_definitions (
        id, item_key, name, category, subcategory, rarity,
        max_stack, sellable, sell_price, buyable, buy_price,
        attributes, description, icon,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, 'seed', $4, $5,
        $6, true, $7, $8, $9,
        $10, $11, $12,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (item_key) DO NOTHING`,
      [
        randomUUID(),
        seed.itemId,
        seed.name,
        deriveSubcategory(seed.cropId),
        normalizeRarity(cropRarity),
        seed.maxStack,
        seed.sellPrice,
        seed.buyPrice > 0,
        seed.buyPrice,
        JSON.stringify({
          cropId: seed.cropId,
          requiredTier: seed.requiredTier,
          seedUnit: seed.seedUnit,
        }),
        seed.description,
        `${seed.itemId}.png`,
      ],
    );
    if (result.rowCount && result.rowCount > 0) {
      insertCount++;
    } else {
      skipCount++;
    }
  }

  // 插入灵材定义
  for (const crop of cropsRaw.crops) {
    const materialKey = `material_${crop.cropId}`;
    const result = await query(
      `INSERT INTO item_definitions (
        id, item_key, name, category, subcategory, rarity,
        max_stack, sellable, sell_price, buyable, buy_price,
        attributes, description, icon,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, 'material', $4, $5,
        999, true, $6, false, 0,
        $7, $8, $9,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT (item_key) DO NOTHING`,
      [
        randomUUID(),
        materialKey,
        crop.name,
        deriveSubcategory(crop.cropId),
        normalizeRarity(crop.rarity),
        crop.sellPricePerUnit,
        JSON.stringify({
          cropId: crop.cropId,
          tradeUnit: crop.harvestTradeUnit,
          harvestUnit: crop.harvestUnit,
        }),
        crop.description,
        `${materialKey}.png`,
      ],
    );
    if (result.rowCount && result.rowCount > 0) {
      insertCount++;
    } else {
      skipCount++;
    }
  }

  console.log(`[步骤1] 物品定义导入完成: 新增=${insertCount}, 已存在跳过=${skipCount}`);
}

async function migrateSeeds(): Promise<{ success: number; failed: number }> {
  console.log('[步骤2] 迁移种子背包...');

  const result = await query<{
    character_id: number;
    item_id: string;
    quantity: number;
    mutation_type: string;
    generation: number;
  }>(`SELECT character_id, item_id, quantity, mutation_type, generation FROM farm_seed_inventory WHERE quantity > 0`);

  let success = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      const addResult = await addItem({
        characterId: row.character_id,
        itemKey: row.item_id,
        quantity: row.quantity,
        attributes: {
          mutationType: row.mutation_type || undefined,
          generation: row.generation || undefined,
        },
        operationType: 'migration',
        bizType: 'data_migration',
        memo: `迁移种子: ${row.item_id} x${row.quantity}`,
      });
      if (addResult.success) success++;
      else {
        console.error(`  失败: char=${row.character_id} ${row.item_id} - ${addResult.message}`);
        failed++;
      }
    } catch (error) {
      console.error(`  异常: char=${row.character_id} ${row.item_id}`, error);
      failed++;
    }
  }

  console.log(`[步骤2] 种子迁移完成: 成功=${success}, 失败=${failed}`);
  return { success, failed };
}

async function migrateHarvests(): Promise<{ success: number; failed: number }> {
  console.log('[步骤3] 迁移灵材仓库...');

  const result = await query<{
    character_id: number;
    crop_id: string;
    quantity: number;
    quality: string;
  }>(`SELECT character_id, crop_id, quantity, quality FROM farm_harvest_inventory WHERE quantity > 0`);

  let success = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      const materialKey = `material_${row.crop_id}`;
      const addResult = await addItem({
        characterId: row.character_id,
        itemKey: materialKey,
        quantity: row.quantity,
        attributes: {
          quality: row.quality || undefined,
        },
        operationType: 'migration',
        bizType: 'data_migration',
        memo: `迁移灵材: ${materialKey} x${row.quantity}`,
      });
      if (addResult.success) success++;
      else {
        console.error(`  失败: char=${row.character_id} ${materialKey} - ${addResult.message}`);
        failed++;
      }
    } catch (error) {
      console.error(`  异常: char=${row.character_id} ${row.crop_id}`, error);
      failed++;
    }
  }

  console.log(`[步骤3] 灵材迁移完成: 成功=${success}, 失败=${failed}`);
  return { success, failed };
}

async function main() {
  console.log('=== 统一背包系统全量迁移 ===\n');

  // 1. 填充物品定义
  await populateItemDefinitions();

  // 2. 重新加载物品配置（让 addItem 能识别新物品）
  await initItemConfig();
  console.log('[准备] 物品配置重新加载完成\n');

  // 3. 迁移种子
  const seedResult = await migrateSeeds();

  // 4. 迁移灵材
  const harvestResult = await migrateHarvests();

  // 5. 总结
  const totalSuccess = seedResult.success + harvestResult.success;
  const totalFailed = seedResult.failed + harvestResult.failed;

  console.log('\n=== 迁移总结 ===');
  console.log(`种子: ${seedResult.success} 成功, ${seedResult.failed} 失败`);
  console.log(`灵材: ${harvestResult.success} 成功, ${harvestResult.failed} 失败`);
  console.log(`总计: ${totalSuccess} 成功, ${totalFailed} 失败`);
  console.log('旧表数据已保留，确认无误后可手动清理。');

  if (totalFailed > 0) {
    console.log('\n⚠ 存在失败记录，请检查上方错误日志。');
  }
}

main().catch((error) => {
  console.error('迁移失败:', error);
  process.exit(1);
});
