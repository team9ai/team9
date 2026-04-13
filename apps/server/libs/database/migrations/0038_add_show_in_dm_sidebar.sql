ALTER TABLE "im_channel_members" ADD COLUMN IF NOT EXISTS "show_in_dm_sidebar" boolean DEFAULT true NOT NULL;
