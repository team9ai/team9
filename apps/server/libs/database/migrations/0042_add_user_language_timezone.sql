-- Adds language + time_zone columns to im_users for client-reported
-- locale preferences. Both are nullable so existing rows stay untouched;
-- the client populates them on authenticated bootstrap, and gateway
-- services (personal-staff.service, common-staff.service) read them to
-- compose the team9:bootstrap.start team9Context payload so agents
-- greet mentors in their preferred language / time zone.

ALTER TABLE "im_users" ADD COLUMN IF NOT EXISTS "language" varchar(16);
ALTER TABLE "im_users" ADD COLUMN IF NOT EXISTS "time_zone" varchar(64);
