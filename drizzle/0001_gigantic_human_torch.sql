CREATE TABLE `recovery_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`tournament_id` text NOT NULL,
	`team_id` text,
	`email` text NOT NULL,
	`token_hash` text,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recovery_email` ON `recovery_challenges` (`tournament_id`,`email`);--> statement-breakpoint
CREATE INDEX `idx_recovery_expiry` ON `recovery_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `recovery_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recovery_limits_expiry` ON `recovery_limits` (`expires_at`);