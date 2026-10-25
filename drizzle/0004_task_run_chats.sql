ALTER TABLE "chats" ADD COLUMN "from_task" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Earlier task runs were saved as plain web chats: a web chat with a user message that is exactly
-- one of the user's scheduled-task prompts is one of those runs.
UPDATE "chats" SET "from_task" = true
WHERE "channel" = 'web'
  AND EXISTS (
    SELECT 1 FROM "messages" m
    JOIN "scheduled_jobs" j ON j."user_id" = m."user_id" AND j."prompt" = m."content"
    WHERE m."chat_id" = "chats"."id" AND m."user_id" = "chats"."user_id" AND m."role" = 'user'
  );
