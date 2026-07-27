CREATE TABLE `assistant_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_key` text NOT NULL,
	`garden_id` text NOT NULL,
	`question` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`response` text,
	`input_hash` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `content_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`source_hash` text NOT NULL,
	`row_count` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `garden_states` (
	`user_key` text PRIMARY KEY NOT NULL,
	`garden_id` text DEFAULT 'primary' NOT NULL,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text PRIMARY KEY NOT NULL,
	`user_key` text NOT NULL,
	`result_revision` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recommendation_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_key` text NOT NULL,
	`garden_id` text NOT NULL,
	`task_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`category` text NOT NULL,
	`comment` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
