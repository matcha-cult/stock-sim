CREATE TABLE `farm_crops` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`crop_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`element` text,
	`rarity` text NOT NULL,
	`sort_order` integer NOT NULL,
	`enabled` integer NOT NULL,
	`growth_stage_minutes` text NOT NULL,
	`stage_labels` text NOT NULL,
	`harvestable_stage` integer,
	`seedable_stage` integer,
	`wither_after_minutes` integer NOT NULL,
	`yield_min` integer NOT NULL,
	`yield_max` integer NOT NULL,
	`sell_price_per_unit` integer NOT NULL,
	`harvest_trade_unit` integer NOT NULL,
	`exp_gain` integer NOT NULL,
	`required_tier` integer NOT NULL,
	`seed_item_id` text NOT NULL,
	`seed_unit` text NOT NULL,
	`harvest_unit` text NOT NULL,
	`seed_from_yield` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `farm_crops_crop_id_unique` ON `farm_crops` (`crop_id`);--> statement-breakpoint
CREATE TABLE `farm_global_config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`initial_rows` integer NOT NULL,
	`initial_cols` integer NOT NULL,
	`max_rows` integer NOT NULL,
	`fixed_cols` integer NOT NULL,
	`expansions` text NOT NULL,
	`xi_rang_price` integer NOT NULL,
	`cell_reclaim_spirit_stone` integer NOT NULL,
	`cell_reclaim_xi_rang` integer NOT NULL,
	`farm_tiers` text NOT NULL,
	`initial_seeds` text NOT NULL,
	`mutation_base_rate` real NOT NULL,
	`mutation_positive_rate` real NOT NULL,
	`mutation_neutral_rate` real NOT NULL,
	`mutation_negative_rate` real NOT NULL,
	`mutation_inherit_rate` real NOT NULL,
	`quality_hq_rate` real NOT NULL,
	`quality_normal_rate` real NOT NULL,
	`quality_lq_rate` real NOT NULL,
	`quality_hq_seed_rate` real NOT NULL,
	`hybrid_cooldown_minutes` integer NOT NULL,
	`acceleration_multiplier` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `farm_hybrid_recipes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recipe_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`enabled` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`parent_a_element` text NOT NULL,
	`parent_b_element` text NOT NULL,
	`result_crop_id` text NOT NULL,
	`result_seed_item_id` text NOT NULL,
	`result_quantity` integer NOT NULL,
	`success_rate` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `farm_hybrid_recipes_recipe_id_unique` ON `farm_hybrid_recipes` (`recipe_id`);--> statement-breakpoint
CREATE TABLE `farm_seeds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` text NOT NULL,
	`crop_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`buy_price` integer NOT NULL,
	`sell_price` integer NOT NULL,
	`stackable` integer NOT NULL,
	`max_stack` integer NOT NULL,
	`required_tier` integer NOT NULL,
	`enabled` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`seed_unit` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `farm_seeds_item_id_unique` ON `farm_seeds` (`item_id`);