-- 0047_fair_blink already added `content_ast` idempotently. This migration
-- is kept for journal integrity (pre-merge dev-authored), made idempotent
-- so fresh DBs applying 0047 → 0050 don't fail on duplicate column.
ALTER TABLE "im_messages" ADD COLUMN IF NOT EXISTS "content_ast" jsonb;
