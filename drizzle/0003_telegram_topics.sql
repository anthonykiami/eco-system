ALTER TABLE "agents" ADD COLUMN "telegram_topic_id" integer;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "telegram_topic_id" integer;--> statement-breakpoint
CREATE INDEX "chats_user_id_telegram_topic_id_idx" ON "chats" USING btree ("user_id","telegram_topic_id");