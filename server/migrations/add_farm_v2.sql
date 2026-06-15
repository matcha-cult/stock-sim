-- 灵田系统 V2 数据库表
-- 执行方式：手动执行 SQL

-- 角色灵田信息表
CREATE TABLE IF NOT EXISTS farm_profile (
  id                     SERIAL PRIMARY KEY,
  character_id           INT NOT NULL UNIQUE REFERENCES characters(id) ON DELETE CASCADE,
  farm_level             SMALLINT NOT NULL DEFAULT 1,
  farm_exp               BIGINT NOT NULL DEFAULT 0,
  max_row                SMALLINT NOT NULL DEFAULT 4,
  total_harvest_count    INT NOT NULL DEFAULT 0,
  harvest_count_by_crop  JSONB NOT NULL DEFAULT '{}',
  initial_seeds_claimed  BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_farm_profile_character ON farm_profile(character_id);

-- 灵田格子表（替代 V1 的 farm_plot）
CREATE TABLE IF NOT EXISTS farm_cell (
  id                      SERIAL PRIMARY KEY,
  character_id            INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  row                     SMALLINT NOT NULL,
  col                     SMALLINT NOT NULL,
  unlocked                BOOLEAN NOT NULL DEFAULT false,
  crop_id                 VARCHAR(64),
  planted_at              TIMESTAMP(6),
  mutated                 BOOLEAN NOT NULL DEFAULT false,
  mutation_type           VARCHAR(32),
  hybrid_cooldown_until   TIMESTAMP(6),
  pending_hybrid_seed     VARCHAR(64),
  planted_generation        INT NOT NULL DEFAULT 0,
  created_at              TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP(6) NOT NULL DEFAULT NOW(),

  UNIQUE(character_id, row, col)
);

CREATE INDEX IF NOT EXISTS idx_farm_cell_character ON farm_cell(character_id);
CREATE INDEX IF NOT EXISTS idx_farm_cell_crop ON farm_cell(character_id, crop_id);

-- 种子背包表
CREATE TABLE IF NOT EXISTS farm_seed_inventory (
  id              SERIAL PRIMARY KEY,
  character_id    INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id         VARCHAR(64) NOT NULL,
  quantity        INT NOT NULL DEFAULT 0,
  mutation_type   VARCHAR(32),
  generation      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP(6) NOT NULL DEFAULT NOW(),

  UNIQUE(character_id, item_id, mutation_type)
);

CREATE INDEX IF NOT EXISTS idx_farm_seed_character ON farm_seed_inventory(character_id);

-- 灵材仓库表（按品质分别计数）
CREATE TABLE IF NOT EXISTS farm_harvest_inventory (
  id              SERIAL PRIMARY KEY,
  character_id    INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  crop_id         VARCHAR(64) NOT NULL,
  quantity        INT NOT NULL DEFAULT 0,
  quality         VARCHAR(10) NOT NULL DEFAULT 'normal',
  created_at      TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP(6) NOT NULL DEFAULT NOW(),

  UNIQUE(character_id, crop_id, quality)
);

CREATE INDEX IF NOT EXISTS idx_farm_harvest_character ON farm_harvest_inventory(character_id);

-- 灵田装饰表
CREATE TABLE IF NOT EXISTS farm_decoration (
  id                SERIAL PRIMARY KEY,
  character_id      INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  row               SMALLINT NOT NULL,
  col               SMALLINT NOT NULL,
  decoration_type   VARCHAR(20) NOT NULL,
  placed_at         TIMESTAMP(6) NOT NULL DEFAULT NOW(),

  UNIQUE(character_id, row, col)
);

CREATE INDEX IF NOT EXISTS idx_farm_decoration_character ON farm_decoration(character_id);

-- 灵田活动日志表（播种/收获/铲除/枯萎/杂交/变异记录）
CREATE TABLE IF NOT EXISTS farm_activity_log (
  id              BIGSERIAL PRIMARY KEY,
  character_id    INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  activity_type   VARCHAR(20) NOT NULL,
  row             SMALLINT NOT NULL,
  col             SMALLINT NOT NULL,
  crop_id         VARCHAR(64),
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMP(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_farm_activity_log_character ON farm_activity_log(character_id);
CREATE INDEX IF NOT EXISTS idx_farm_activity_log_character_time ON farm_activity_log(character_id, created_at);
