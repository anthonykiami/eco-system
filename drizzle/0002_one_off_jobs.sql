CREATE TYPE "public"."job_kind" AS ENUM('recurring', 'once', 'reminder');--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD COLUMN "kind" "job_kind" DEFAULT 'recurring' NOT NULL;