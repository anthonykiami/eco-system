ALTER TABLE "agents" ADD COLUMN "telegram_bot_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "telegram_bot_username" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "telegram_bot_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "telegram_group_chat_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_telegram_bot_id_unique" ON "agents" USING btree ("telegram_bot_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_telegram_group_chat_id_unique" UNIQUE("telegram_group_chat_id");