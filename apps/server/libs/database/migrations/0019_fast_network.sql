DROP INDEX "idx_bots_access_token";--> statement-breakpoint
CREATE INDEX "idx_message_attachments_message_id" ON "im_message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_members_user_id" ON "tenant_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_workspace_invitations_tenant_id" ON "workspace_invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_bots_access_token" ON "im_bots" USING btree ("access_token" text_pattern_ops);