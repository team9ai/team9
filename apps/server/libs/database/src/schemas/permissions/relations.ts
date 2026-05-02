import { relations } from 'drizzle-orm';
import { authPermissionGrants } from './grants.js';
import { authPermissionRequests } from './requests.js';

export const authPermissionGrantsRelations = relations(
  authPermissionGrants,
  ({ one }) => ({
    request: one(authPermissionRequests, {
      fields: [authPermissionGrants.requestId],
      references: [authPermissionRequests.id],
    }),
  }),
);

export const authPermissionRequestsRelations = relations(
  authPermissionRequests,
  ({ one }) => ({
    durableGrant: one(authPermissionGrants, {
      fields: [authPermissionRequests.durableGrantId],
      references: [authPermissionGrants.id],
    }),
  }),
);
