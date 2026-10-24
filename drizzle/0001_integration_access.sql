CREATE TABLE "integration_access" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"toolkit" text NOT NULL,
	"access" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_access" ADD CONSTRAINT "integration_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_access_user_id_toolkit_unique" ON "integration_access" USING btree ("user_id","toolkit");