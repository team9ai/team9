ALTER TYPE "public"."channel_type" ADD VALUE 'topic-session';--> statement-breakpoint
ALTER TABLE "im_messages" ADD COLUMN "content_ast" jsonb;