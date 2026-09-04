CREATE TABLE IF NOT EXISTS `inventory` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`product_id` integer,
	`card_name` text,
	`card_number` text,
	`set_name` text,
	`variant` text,
	`condition` text,
	`purchase_price` real,
	`sticker_price` real,
	`date_bought` text,
	`is_bulk_deal` integer DEFAULT 0,
	`is_sold` integer DEFAULT 0,
	`sold_price` real DEFAULT 0,
	`date_sold` text DEFAULT '',
	`custom_image_data` text,
	`is_deleted` integer DEFAULT 0,
	`updated_at` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sync_metadata` (
	`user_id` text PRIMARY KEY,
	`last_updated` real DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tour_state` (
	`user_id` text PRIMARY KEY,
	`has_seen_tour` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `vendor_settings` (
	`user_id` text PRIMARY KEY,
	`settings_json` text NOT NULL,
	`updated_at` real DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_inventory_user_sold_deleted` ON `inventory` (`user_id`,`is_sold`,`is_deleted`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_inventory_user_updated` ON `inventory` (`user_id`,`updated_at`);