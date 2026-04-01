UPDATE "im_user_email_change_requests"
SET "status" = 'expired', "updated_at" = now()
WHERE "status" = 'pending' AND "expires_at" <= now();--> statement-breakpoint
WITH ranked_pending_by_user AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "user_id"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS "row_num"
  FROM "im_user_email_change_requests"
  WHERE "status" = 'pending'
)
UPDATE "im_user_email_change_requests" AS "requests"
SET "status" = 'cancelled', "updated_at" = now()
FROM ranked_pending_by_user
WHERE "requests"."id" = ranked_pending_by_user."id"
  AND ranked_pending_by_user."row_num" > 1;--> statement-breakpoint
WITH ranked_pending_by_email AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "new_email"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS "row_num"
  FROM "im_user_email_change_requests"
  WHERE "status" = 'pending'
)
UPDATE "im_user_email_change_requests" AS "requests"
SET "status" = 'cancelled', "updated_at" = now()
FROM ranked_pending_by_email
WHERE "requests"."id" = ranked_pending_by_email."id"
  AND ranked_pending_by_email."row_num" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_email_change_requests_pending_user" ON "im_user_email_change_requests" USING btree ("user_id") WHERE "im_user_email_change_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_email_change_requests_pending_new_email" ON "im_user_email_change_requests" USING btree ("new_email") WHERE "im_user_email_change_requests"."status" = 'pending';
