CREATE TABLE `apps` (
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`created` integer NOT NULL,
	PRIMARY KEY(`user_id`, `name`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `installs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`app` text DEFAULT '' NOT NULL,
	`refresh_hash` text,
	`read` text NOT NULL,
	`stopped` text,
	`created` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installs_refresh_hash_unique` ON `installs` (`refresh_hash`);--> statement-breakpoint
CREATE INDEX `installs_user_app` ON `installs` (`user_id`,`app`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`quota_bytes` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`login_hash` text NOT NULL,
	`recovery_hash` text NOT NULL,
	`m` integer NOT NULL,
	`t` integer NOT NULL,
	`p` integer NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`verified` integer,
	`created` integer NOT NULL,
	FOREIGN KEY (`plan`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);