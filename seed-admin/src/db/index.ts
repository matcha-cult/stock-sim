import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";

const dbPath = path.join(process.cwd(), "data", "seed.db");
const sqlite = new Database(dbPath);

// 启动时迁移：检测 farm_hybrid_recipes 是否为旧结构，若是则重建为新结构
const recipeCols = sqlite
  .prepare("PRAGMA table_info(farm_hybrid_recipes)")
  .all() as { name: string }[];
const hasLegacyCols =
  recipeCols.some((c) => c.name === "parent_a_element") ||
  !recipeCols.some((c) => c.name === "base_crop_id");
if (recipeCols.length > 0 && hasLegacyCols) {
  sqlite.exec(`
    DROP TABLE farm_hybrid_recipes;
    CREATE TABLE farm_hybrid_recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      base_crop_id TEXT NOT NULL,
      required_crops TEXT NOT NULL,
      min_required INTEGER,
      result_crop_id TEXT NOT NULL,
      result_seed_item_id TEXT NOT NULL,
      result_quantity INTEGER NOT NULL
    );
  `);
}

export const db = drizzle(sqlite, { schema });
