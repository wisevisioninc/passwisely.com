ALTER TABLE `purchases` ADD `provider` text DEFAULT 'stripe' NOT NULL;
--> statement-breakpoint
ALTER TABLE `purchases` ADD `merchant_order_no` text;
--> statement-breakpoint
ALTER TABLE `purchases` ADD `amount_minor` integer;
--> statement-breakpoint
ALTER TABLE `purchases` ADD `provider_transaction_id` text;
--> statement-breakpoint
UPDATE `purchases` SET `amount_minor` = `amount_cents` WHERE `amount_minor` IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_merchant_order_unique` ON `purchases` (`merchant_order_no`);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_provider_transaction_unique` ON `purchases` (`provider`,`provider_transaction_id`);
