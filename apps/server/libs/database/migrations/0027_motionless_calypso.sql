ALTER TYPE "public"."channel_type" ADD VALUE 'tracking';--> statement-breakpoint
ALTER TABLE "im_channels" ADD COLUMN "is_activated" boolean DEFAULT true NOT NULL;