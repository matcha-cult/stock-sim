-- 迁移：移除 item_definitions 表，使用 item_key 替代 item_definition_id
-- 执行前请备份数据

BEGIN;

-- 1. inventory_items 表：添加 item_key 列，迁移数据，删除旧列
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS item_key VARCHAR(64);

-- 从 item_definitions 表迁移 item_key
UPDATE inventory_items i
SET item_key = d.item_key
FROM item_definitions d
WHERE i.item_definition_id = d.id;

-- 设置 NOT NULL 约束
ALTER TABLE inventory_items ALTER COLUMN item_key SET NOT NULL;

-- 删除旧列和外键
ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS inventory_items_item_definition_id_fkey;
ALTER TABLE inventory_items DROP COLUMN IF EXISTS item_definition_id;

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_inventory_items_item_key ON inventory_items(item_key);
CREATE INDEX IF NOT EXISTS idx_inventory_items_char_item_key ON inventory_items(character_id, item_key);
DROP INDEX IF EXISTS idx_inventory_items_item_definition_id;
DROP INDEX IF EXISTS idx_inventory_items_char_item_definition_id;

-- 2. inventory_ledger 表：同样的迁移
ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS item_key VARCHAR(64);

UPDATE inventory_ledger l
SET item_key = d.item_key
FROM item_definitions d
WHERE l.item_definition_id = d.id;

ALTER TABLE inventory_ledger ALTER COLUMN item_key SET NOT NULL;

ALTER TABLE inventory_ledger DROP CONSTRAINT IF EXISTS inventory_ledger_item_definition_id_fkey;
ALTER TABLE inventory_ledger DROP COLUMN IF EXISTS item_definition_id;

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_item_key ON inventory_ledger(item_key);
DROP INDEX IF EXISTS idx_inventory_ledger_item_definition_id;

-- 3. 删除 item_definitions 表
DROP TABLE IF EXISTS item_definitions;

COMMIT;
