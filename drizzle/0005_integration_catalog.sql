CREATE TABLE "integration_catalog" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"logo" text,
	"full_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"read_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"safe_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
