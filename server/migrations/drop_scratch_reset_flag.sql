-- 移除重置票据功能，删除 reset_flag 列
ALTER TABLE scratch_ticket DROP COLUMN IF EXISTS reset_flag;
