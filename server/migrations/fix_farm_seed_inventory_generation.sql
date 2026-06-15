-- 修复 farm_seed_inventory 种子代数 bug：
-- 当前唯一约束 (character_id, item_id, COALESCE(mutation_type, '')) 没有包含 generation，
-- 导致商店购买的种子（应为 G0）与收获的杂交种子（G1/G2/G3）合并到同一条记录。

-- 1. 删除旧的唯一索引
DROP INDEX IF EXISTS udx_farm_seed_inventory_agg;

-- 2. 创建新的唯一索引（包含 generation）
CREATE UNIQUE INDEX udx_farm_seed_inventory_agg
  ON farm_seed_inventory (character_id, item_id, COALESCE(mutation_type, ''), generation);
