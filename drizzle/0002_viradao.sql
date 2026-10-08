CREATE TABLE `viradao_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_viradao_events_date` ON `viradao_events` (`starts_at`);--> statement-breakpoint
CREATE TABLE `viradao_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`name` text NOT NULL,
	`nick` text NOT NULL,
	`payment` text DEFAULT 'unpaid' NOT NULL,
	`receipt_key` text,
	`receipt_type` text,
	`removed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `viradao_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_viradao_participants_event` ON `viradao_participants` (`event_id`,`created_at`);