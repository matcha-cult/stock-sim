-- 修复 farm_seed_inventory 种子聚合 bug：
-- PostgreSQL UNIQUE 约束对 NULL 值不做等值比较（NULL ≠ NULL），
-- 导致 mutation_type 为 NULL 时 ON CONFLICT 无法检测冲突，每次购买都插入新行。
-- 改用 COALESCE 唯一索引，使 NULL 与 NULL 视为相同。

-- 1. 删除旧的 UNIQUE 约束（对 NULL 不生效）
ALTER TABLE farm_seed_inventory DROP CONSTRAINT IF EXISTS farm_seed_inventory_character_id_item_id_mutation_type_key;

-- 2. 创建 COALESCE 唯一索引，NULL 与 NULL 视为相同
CREATE UNIQUE INDEX udx_farm_seed_inventory_agg
  ON farm_seed_inventory (character_id, item_id, COALESCE(mutation_type, ''));

-- 3. 移除 hybrid_cooldown_until 字段（杂交冷却机制已移除）
ALTER TABLE farm_cell DROP COLUMN IF EXISTS hybrid_cooldown_until;
