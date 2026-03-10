CREATE TYPE "public"."skill__type" AS ENUM('claude_code_skill', 'prompt_template', 'general');--> statement-breakpoint
CREATE TYPE "public"."skill_version__status" AS ENUM('draft', 'published', 'suggested', 'rejected');--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"type" "skill__type" NOT NULL,
	"icon" varchar(64),
	"current_version" integer DEFAULT 0 NOT NULL,
	"creator_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"skill_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"message" varchar(255),
	"status" "skill_version__status" DEFAULT 'draft' NOT NULL,
	"file_manifest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_by" varchar(64),
	"creator_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"skill_id" uuid NOT NULL,
	"path" varchar(1024) NOT NULL,
	"content" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_creator_id_im_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_creator_id_im_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."im_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_files" ADD CONSTRAINT "skill_files_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_skills_tenant_id" ON "skills" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_skill_versions_skill_version" ON "skill_versions" USING btree ("skill_id","version");--> statement-breakpoint
CREATE INDEX "idx_skill_files_skill_id" ON "skill_files" USING btree ("skill_id");