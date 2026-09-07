ALTER TABLE `sync_metadata` ADD COLUMN `last_pushed_local_updated_at` real DEFAULT 0;
--> statement-breakpoint
UPDATE `sync_metadata` SET `last_pushed_local_updated_at` = `last_updated`;
