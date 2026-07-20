/**
 * 统一背包系统 — 数据迁移脚本。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：将现有的 farm_seed_inventory 和 farm_harvest_inventory 数据迁移到新的统一背包表。
 * 2. 不做什么：不删除旧表（保留作为备份）、不回滚。
 *
 * 输入 / 输出：
 * - 输入：旧表数据（farm_seed_inventory, farm_harvest_inventory）
 * - 输出：新表数据（inventory_items, inventory_ledger）
 *
 * 数据流 / 状态流：
 * 读取旧表 → 转换数据格式 → 插入新表 → 记录流水 → 完成。
 *
 * 复用设计说明：
 * - 复用 unifiedInventoryService.addItem() 方法。
 * - 复用 itemConfigLoader 获取物品定义。
 *
 * 关键边界条件与坑点：
 * 1. 迁移前必须确保 item_definitions 表已填充数据。
 * 2. 迁移过程中如果失败，需要手动清理已迁移的数据。
 * 3. 迁移完成后，旧表数据保留作为备份，不自动删除。
 */
import { query } from '../src/config/database.js';
import { addItem } from '../src/services/inventory/unifiedInventoryService.js';
import { initItemConfig } from '../src/services/inventory/itemConfigLoader.js';

interface SeedInventoryRow {
  character_id: number;
  item_id: string;
  quantity: number;
  mutation_type: string;
  generation: number;
}

interface HarvestInventoryRow {
  character_id: number;
  crop_id: string;
  quantity: number;
  quality: string;
}

async function migrateSeedInventory(): Promise<{ success: number; failed: number }> {
  console.log('[迁移] 开始迁移种子背包...');

  const result = await query<SeedInventoryRow>(
    `SELECT character_id, item_id, quantity, mutation_type, generation FROM farm_seed_inventory`,
  );

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
        memo: `从旧种子背包迁移: ${row.item_id} x${row.quantity}`,
      });

      if (addResult.success) {
        success++;
      } else {
        console.error(`[迁移] 种子迁移失败: character=${row.character_id}, item=${row.item_id}, error=${addResult.message}`);
        failed++;
      }
    } catch (error) {
      console.error(`[迁移] 种子迁移异常: character=${row.character_id}, item=${row.item_id}`, error);
      failed++;
    }
  }

  console.log(`[迁移] 种子背包迁移完成: 成功=${success}, 失败=${failed}`);
  return { success, failed };
}

async function migrateHarvestInventory(): Promise<{ success: number; failed: number }> {
  console.log('[迁移] 开始迁移灵材仓库...');

  const result = await query<HarvestInventoryRow>(
    `SELECT character_id, crop_id, quantity, quality FROM farm_harvest_inventory`,
  );

  let success = 0;
  let failed = 0;

  for (const row of result.rows) {
    try {
      // 将 crop_id 转换为 material 的 itemKey
      // 例如: spirit_root_gold -> material_spirit_root_gold
      const materialItemKey = `material_${row.crop_id}`;

      const addResult = await addItem({
        characterId: row.character_id,
        itemKey: materialItemKey,
        quantity: row.quantity,
        attributes: {
          quality: row.quality || undefined,
        },
        operationType: 'migration',
        bizType: 'data_migration',
        memo: `从旧灵材仓库迁移: ${materialItemKey} x${row.quantity}`,
      });

      if (addResult.success) {
        success++;
      } else {
        console.error(`[迁移] 灵材迁移失败: character=${row.character_id}, item=${materialItemKey}, error=${addResult.message}`);
        failed++;
      }
    } catch (error) {
      console.error(`[迁移] 灵材迁移异常: character=${row.character_id}, item=${row.crop_id}`, error);
      failed++;
    }
  }

  console.log(`[迁移] 灵材仓库迁移完成: 成功=${success}, 失败=${failed}`);
  return { success, failed };
}

async function main() {
  console.log('[迁移] 开始执行统一背包系统数据迁移...');

  // 1. 初始化物品配置
  await initItemConfig();
  console.log('[迁移] 物品配置加载完成');

  // 2. 迁移种子背包
  const seedResult = await migrateSeedInventory();

  // 3. 迁移灵材仓库
  const harvestResult = await migrateHarvestInventory();

  // 4. 输出总结
  console.log('\n[迁移] ========== 迁移总结 ==========');
  console.log(`[迁移] 种子背包: 成功=${seedResult.success}, 失败=${seedResult.failed}`);
  console.log(`[迁移] 灵材仓库: 成功=${harvestResult.success}, 失败=${harvestResult.failed}`);
  console.log(`[迁移] 总计: 成功=${seedResult.success + harvestResult.success}, 失败=${seedResult.failed + harvestResult.failed}`);
  console.log('[迁移] ================================\n');

  console.log('[迁移] 提示: 旧表数据已保留作为备份，确认无误后可手动删除。');
  console.log('[迁移] 提示: 如果需要回滚，请手动清理 inventory_items 和 inventory_ledger 表中 biz_type = \'data_migration\' 的记录。');
}

main().catch((error) => {
  console.error('[迁移] 迁移失败:', error);
  process.exit(1);
});
