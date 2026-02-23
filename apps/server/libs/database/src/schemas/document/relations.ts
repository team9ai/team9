import { relations } from 'drizzle-orm';
import { documents } from './documents.js';
import { documentVersions } from './document-versions.js';
import { documentSuggestions } from './document-suggestions.js';
import { tenants } from '../tenant/tenants.js';

export const documentsRelations = relations(documents, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [documents.tenantId],
    references: [tenants.id],
  }),
  currentVersion: one(documentVersions, {
    fields: [documents.currentVersionId],
    references: [documentVersions.id],
    relationName: 'documentCurrentVersion',
  }),
  versions: many(documentVersions),
  suggestions: many(documentSuggestions),
}));

export const documentVersionsRelations = relations(
  documentVersions,
  ({ one }) => ({
    document: one(documents, {
      fields: [documentVersions.documentId],
      references: [documents.id],
    }),
  }),
);

export const documentSuggestionsRelations = relations(
  documentSuggestions,
  ({ one }) => ({
    document: one(documents, {
      fields: [documentSuggestions.documentId],
      references: [documents.id],
    }),
    fromVersion: one(documentVersions, {
      fields: [documentSuggestions.fromVersionId],
      references: [documentVersions.id],
      relationName: 'suggestionFromVersion',
    }),
    resultVersion: one(documentVersions, {
      fields: [documentSuggestions.resultVersionId],
      references: [documentVersions.id],
      relationName: 'suggestionResultVersion',
    }),
  }),
);
