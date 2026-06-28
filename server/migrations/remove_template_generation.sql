-- 移除模板项的 generation 列
-- 模板只记录种子类型（seedItemId）和变异类型（mutationType），不记录种子代数
-- 应用模板时，从玩家库存中匹配符合 seedItemId + mutationType 的任意代数种子即可

ALTER TABLE farm_plant_template_item DROP COLUMN IF EXISTS generation;
