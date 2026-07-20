/**
 * 统一背包系统 — 物品定义初始化脚本。
 *
 * 作用（做什么 / 不做什么）：
 * 1. 做什么：将 items.json 中的物品定义导入到 item_definitions 表。
 * 2. 不做什么：不更新已存在的物品定义、不删除旧数据。
 *
 * 输入 / 输出：
 * - 输入：data/seeds/inventory/items.json
 * - 输出：item_definitions 表数据
 *
 * 数据流 / 状态流：
 * 读取 JSON → 转换为数据库记录 → 批量插入 → 完成。
 *
 * 关键边界条件与坑点：
 * 1. 使用 ON CONFLICT DO NOTHING，已存在的物品不会重复插入。
 * 2. 需要在应用启动前执行此脚本。
 * 3. 显式生成 UUID 作为 id，避免数据库默认值未生效的问题。
 */
import { readFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { query } from '../src/config/database.js';

interface ItemDefinitionRaw {
  itemKey: string;
  name: string;
  category: string;
  subcategory?: string;
  rarity?: string;
  maxStack: number;
  sellable: boolean;
  sellPrice: number;
  buyable: boolean;
  buyPrice: number;
  attributes: Record<string, any>;
  description?: string;
  icon?: string;
}

async function main() {
  console.log('[初始化] 开始导入物品定义...');

  // 1. 读取 items.json
  const itemsPath = join(process.cwd(), 'data/seeds/inventory/items.json');
  const content = await readFile(itemsPath, 'utf-8');
  const raw = JSON.parse(content) as { items: ItemDefinitionRaw[] };
  const items = raw.items;

  console.log(`[初始化] 读取到 ${items.length} 个物品定义`);

  // 2. 批量插入到 item_definitions 表
  let successCount = 0;
  let skipCount = 0;

  for (const item of items) {
    try {
      const result = await query(
        `
        INSERT INTO item_definitions (
          id, item_key, name, category, subcategory, rarity,
          max_stack, sellable, sell_price, buyable, buy_price,
          attributes, description, icon,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (item_key) DO NOTHING
        RETURNING id
        `,
        [
          randomUUID(),
          item.itemKey,
          item.name,
          item.category,
          item.subcategory || null,
          item.rarity || null,
          item.maxStack,
          item.sellable,
          item.sellPrice,
          item.buyable,
          item.buyPrice ?? 0,
          JSON.stringify(item.attributes),
          item.description || null,
          item.icon || null,
        ],
      );

      if (result.rowCount && result.rowCount > 0) {
        successCount++;
        console.log(`[初始化] ✓ 导入成功: ${item.itemKey} (${item.name})`);
      } else {
        skipCount++;
        console.log(`[初始化] ⊘ 已存在，跳过: ${item.itemKey}`);
      }
    } catch (error) {
      console.error(`[初始化] ✗ 导入失败: ${item.itemKey}`, error);
    }
  }

  // 3. 输出总结
  console.log('\n[初始化] ========== 导入总结 ==========');
  console.log(`[初始化] 成功导入: ${successCount} 个`);
  console.log(`[初始化] 已存在跳过: ${skipCount} 个`);
  console.log(`[初始化] 总计: ${items.length} 个`);
  console.log('[初始化] =================================\n');

  console.log('[初始化] 提示: 物品定义已导入，可以开始使用统一背包系统。');
}

main().catch((error) => {
  console.error('[初始化] 导入失败:', error);
  process.exit(1);
});
