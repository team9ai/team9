ALTER TYPE "public"."message_type" ADD VALUE 'tracking';--> statement-breakpoint
ALTER TABLE "im_channels" ADD COLUMN "snapshot" jsonb;