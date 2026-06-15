-- 将 farm_seed_inventory.mutation_type 从 nullable 改为非空（'' 代替 NULL），
-- 使 Prisma @@unique 可直接表达唯一约束，消除 prisma db push 破坏数据库的风险。

-- 1. 将现有 NULL 替换为 ''
UPDATE farm_seed_inventory SET mutation_type = '' WHERE mutation_type IS NULL;

-- 2. 删除旧的 COALESCE 唯一索引
DROP INDEX IF EXISTS udx_farm_seed_inventory_agg;

-- 3. 列改为非空
ALTER TABLE farm_seed_inventory ALTER COLUMN mutation_type SET NOT NULL;
ALTER TABLE farm_seed_inventory ALTER COLUMN mutation_type SET DEFAULT '';

-- 4. 创建普通唯一约束（Prisma 可识别）
ALTER TABLE farm_seed_inventory
  ADD CONSTRAINT farm_seed_inventory_character_item_mutation_gen_key
  UNIQUE (character_id, item_id, mutation_type, generation);
