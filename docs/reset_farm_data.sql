-- 重置所有玩家的灵田数据（V4）
-- 用途：内测删档 / 开发测试环境清空灵田相关数据，让玩家重新进入开垦流程
-- 影响范围：farm_cell, farm_seed_inventory, farm_harvest_inventory,
--           farm_decoration, farm_profile, farm_activity_log,
--           farm_plant_template, farm_plant_template_item
-- 注意：此操作不可逆，执行前请确认
--
-- 版本演进：
--   V3: farm_profile 的 farm_tier（等阶）与 farm_level（等级）分离
--   V4: 补充种植模板相关表（farm_plant_template / farm_plant_template_item）；
--       移除已废弃的 xi_rang_count 字段说明（息壤现按 cell 动态计算，不再持久化到 profile）

BEGIN;

-- 1. 清空灵田格子数据（作物、种植状态、装饰物）
DELETE FROM farm_cell;

-- 2. 清空种子背包
DELETE FROM farm_seed_inventory;

-- 3. 清空灵材仓库
DELETE FROM farm_harvest_inventory;

-- 4. 清空装饰物
DELETE FROM farm_decoration;

-- 5. 清空种植模板（先删子表 farm_plant_template_item，避免外键悬挂）
DELETE FROM farm_plant_template_item;
DELETE FROM farm_plant_template;

-- 6. 清空灵田档案
-- 当前字段：farm_tier (1-4: 黄/玄/地/天), farm_level (0-100), farm_exp,
--           max_row, initial_seeds_claimed
DELETE FROM farm_profile;

-- 7. 清空活动日志（播种/收获/铲除/枯萎/杂交/变异记录）
DELETE FROM farm_activity_log;

COMMIT;

-- 验证：执行后可查看各表数据量
 SELECT 'farm_profile' AS table_name, COUNT(*) AS count FROM farm_profile
 UNION ALL SELECT 'farm_cell', COUNT(*) FROM farm_cell
 UNION ALL SELECT 'farm_seed_inventory', COUNT(*) FROM farm_seed_inventory
 UNION ALL SELECT 'farm_harvest_inventory', COUNT(*) FROM farm_harvest_inventory
 UNION ALL SELECT 'farm_decoration', COUNT(*) FROM farm_decoration
 UNION ALL SELECT 'farm_plant_template', COUNT(*) FROM farm_plant_template
 UNION ALL SELECT 'farm_plant_template_item', COUNT(*) FROM farm_plant_template_item
 UNION ALL SELECT 'farm_activity_log', COUNT(*) FROM farm_activity_log;
