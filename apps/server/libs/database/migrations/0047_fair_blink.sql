ALTER TYPE "public"."channel_type" ADD VALUE IF NOT EXISTS 'topic-session';--> statement-breakpoint
ALTER TABLE "im_messages" ADD COLUMN IF NOT EXISTS "content_ast" jsonb;
