import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  desc,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  DocumentIdentity,
  DocumentPrivilege,
  DocumentSuggestionData,
} from '@team9/database/schemas';
import { diffLines, type Change } from 'diff';
import type { CreateDocumentDto } from './dto/create-document.dto.js';
import type { UpdateDocumentDto } from './dto/update-document.dto.js';
import type { SubmitSuggestionDto } from './dto/submit-suggestion.dto.js';

// ── Response types ──────────────────────────────────────────────────

export interface DocumentResponse {
  id: string;
  tenantId: string;
  documentType: string;
  title: string | null;
  privileges: DocumentPrivilege[];
  createdBy: DocumentIdentity;
  currentVersion: {
    id: string;
    versionIndex: number;
    content: string;
    summary: string | null;
    updatedBy: DocumentIdentity;
    createdAt: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VersionResponse {
  id: string;
  documentId: string;
  versionIndex: number;
  content: string;
  summary: string | null;
  updatedBy: DocumentIdentity;
  createdAt: Date;
}

export interface SuggestionResponse {
  id: string;
  documentId: string;
  fromVersionId: string;
  suggestedBy: DocumentIdentity;
  data: DocumentSuggestionData;
  summary: string | null;
  status: string;
  reviewedBy: DocumentIdentity | null;
  reviewedAt: Date | null;
  resultVersionId: string | null;
  createdAt: Date;
}

export interface DocumentListItem {
  id: string;
  documentType: string;
  title: string | null;
  createdBy: DocumentIdentity;
  updatedAt: Date;
  createdAt: Date;
}

export interface SuggestionDetailResponse {
  suggestion: SuggestionResponse;
  fromVersion: { versionIndex: number; content: string };
  currentVersion: { versionIndex: number; content: string } | null;
  diff: Change[];
  isOutdated: boolean;
}

// ── Service ─────────────────────────────────────────────────────────

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  // ── CRUD ────────────────────────────────────────────────────────

  async list(tenantId: string): Promise<DocumentListItem[]> {
    const docs = await this.db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.tenantId, tenantId))
      .orderBy(desc(schema.documents.updatedAt));

    return docs.map((d) => ({
      id: d.id,
      documentType: d.documentType,
      title: d.title,
      createdBy: d.createdBy,
      updatedAt: d.updatedAt,
      createdAt: d.createdAt,
    }));
  }

  async create(
    dto: CreateDocumentDto,
    identity: DocumentIdentity,
    tenantId: string,
  ): Promise<DocumentResponse> {
    const docId = uuidv7();
    const versionId = uuidv7();

    // Default privileges: creator is owner + workspace users are owners
    const WS_USERS_OWNER: DocumentPrivilege = {
      identity: { type: 'workspace', userType: 'user' },
      role: 'owner',
    };
    const privileges: DocumentPrivilege[] = dto.privileges ?? [
      { identity, role: 'owner' },
      WS_USERS_OWNER,
    ];
    // Ensure creator is at least owner if custom privileges don't include them
    if (!privileges.some((p) => this.matchIdentity(p.identity, identity))) {
      privileges.push({ identity, role: 'owner' });
    }
    // Ensure workspace users always have owner access
    if (
      !privileges.some(
        (p) =>
          p.identity.type === 'workspace' &&
          (p.identity.userType === 'user' || p.identity.userType === 'all') &&
          p.role === 'owner',
      )
    ) {
      privileges.push(WS_USERS_OWNER);
    }

    // Create document
    const [doc] = await this.db
      .insert(schema.documents)
      .values({
        id: docId,
        tenantId,
        documentType: dto.documentType,
        title: dto.title ?? null,
        privileges,
        currentVersionId: versionId,
        createdBy: identity,
      })
      .returning();

    // Create initial version
    const [version] = await this.db
      .insert(schema.documentVersions)
      .values({
        id: versionId,
        documentId: docId,
        versionIndex: 1,
        content: dto.content,
        summary: 'Initial version',
        updatedBy: identity,
      })
      .returning();

    return {
      id: doc.id,
      tenantId: doc.tenantId,
      documentType: doc.documentType,
      title: doc.title,
      privileges: doc.privileges,
      createdBy: doc.createdBy,
      currentVersion: {
        id: version.id,
        versionIndex: version.versionIndex,
        content: version.content,
        summary: version.summary,
        updatedBy: version.updatedBy,
        createdAt: version.createdAt,
      },
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async getById(id: string): Promise<DocumentResponse> {
    const [doc] = await this.db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id))
      .limit(1);

    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    let currentVersion: DocumentResponse['currentVersion'] = null;
    if (doc.currentVersionId) {
      const [ver] = await this.db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, doc.currentVersionId))
        .limit(1);
      if (ver) {
        currentVersion = {
          id: ver.id,
          versionIndex: ver.versionIndex,
          content: ver.content,
          summary: ver.summary,
          updatedBy: ver.updatedBy,
          createdAt: ver.createdAt,
        };
      }
    }

    return {
      id: doc.id,
      tenantId: doc.tenantId,
      documentType: doc.documentType,
      title: doc.title,
      privileges: doc.privileges,
      createdBy: doc.createdBy,
      currentVersion,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  async update(
    id: string,
    dto: UpdateDocumentDto,
    identity: DocumentIdentity,
  ): Promise<VersionResponse> {
    const doc = await this.getDocOrThrow(id);
    this.assertPermission(doc, identity, ['owner', 'editor']);

    // Get max versionIndex
    const [maxVer] = await this.db
      .select({ versionIndex: schema.documentVersions.versionIndex })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, id))
      .orderBy(desc(schema.documentVersions.versionIndex))
      .limit(1);

    const nextVersionIndex = (maxVer?.versionIndex ?? 0) + 1;
    const versionId = uuidv7();

    const [version] = await this.db
      .insert(schema.documentVersions)
      .values({
        id: versionId,
        documentId: id,
        versionIndex: nextVersionIndex,
        content: dto.content,
        summary: dto.summary ?? null,
        updatedBy: identity,
      })
      .returning();

    // Update document's currentVersionId
    await this.db
      .update(schema.documents)
      .set({
        currentVersionId: versionId,
        updatedAt: new Date(),
      })
      .where(eq(schema.documents.id, id));

    return {
      id: version.id,
      documentId: version.documentId,
      versionIndex: version.versionIndex,
      content: version.content,
      summary: version.summary,
      updatedBy: version.updatedBy,
      createdAt: version.createdAt,
    };
  }

  // ── Privileges ──────────────────────────────────────────────────

  async updatePrivileges(
    id: string,
    privileges: DocumentPrivilege[],
    identity: DocumentIdentity,
  ): Promise<void> {
    const doc = await this.getDocOrThrow(id);
    this.assertPermission(doc, identity, ['owner']);

    await this.db
      .update(schema.documents)
      .set({ privileges, updatedAt: new Date() })
      .where(eq(schema.documents.id, id));
  }

  // ── Versions ────────────────────────────────────────────────────

  async getVersions(documentId: string): Promise<VersionResponse[]> {
    await this.getDocOrThrow(documentId);

    const versions = await this.db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId))
      .orderBy(desc(schema.documentVersions.versionIndex));

    return versions.map((v) => ({
      id: v.id,
      documentId: v.documentId,
      versionIndex: v.versionIndex,
      content: v.content,
      summary: v.summary,
      updatedBy: v.updatedBy,
      createdAt: v.createdAt,
    }));
  }

  async getVersion(
    documentId: string,
    versionIndex: number,
  ): Promise<VersionResponse> {
    const [version] = await this.db
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.documentId, documentId),
          eq(schema.documentVersions.versionIndex, versionIndex),
        ),
      )
      .limit(1);

    if (!version) {
      throw new NotFoundException(
        `Version ${versionIndex} not found for document ${documentId}`,
      );
    }

    return {
      id: version.id,
      documentId: version.documentId,
      versionIndex: version.versionIndex,
      content: version.content,
      summary: version.summary,
      updatedBy: version.updatedBy,
      createdAt: version.createdAt,
    };
  }

  // ── Suggestions ─────────────────────────────────────────────────

  async submitSuggestion(
    documentId: string,
    dto: SubmitSuggestionDto,
    identity: DocumentIdentity,
  ): Promise<SuggestionResponse> {
    const doc = await this.getDocOrThrow(documentId);
    this.assertPermission(doc, identity, ['owner', 'editor', 'suggester']);

    if (!doc.currentVersionId) {
      throw new NotFoundException('Document has no versions');
    }

    const sugId = uuidv7();
    const [suggestion] = await this.db
      .insert(schema.documentSuggestions)
      .values({
        id: sugId,
        documentId,
        fromVersionId: doc.currentVersionId,
        suggestedBy: identity,
        data: dto.data,
        summary: dto.summary ?? null,
      })
      .returning();

    return this.toSuggestionResponse(suggestion);
  }

  async getSuggestions(
    documentId: string,
    status?: string,
  ): Promise<SuggestionResponse[]> {
    await this.getDocOrThrow(documentId);

    const conditions = [eq(schema.documentSuggestions.documentId, documentId)];
    if (status) {
      conditions.push(
        eq(
          schema.documentSuggestions.status,
          status as 'pending' | 'approved' | 'rejected',
        ),
      );
    }

    const suggestions = await this.db
      .select()
      .from(schema.documentSuggestions)
      .where(and(...conditions))
      .orderBy(desc(schema.documentSuggestions.createdAt));

    return suggestions.map((s) => this.toSuggestionResponse(s));
  }

  async getSuggestionWithDiff(
    suggestionId: string,
  ): Promise<SuggestionDetailResponse> {
    const [suggestion] = await this.db
      .select()
      .from(schema.documentSuggestions)
      .where(eq(schema.documentSuggestions.id, suggestionId))
      .limit(1);

    if (!suggestion) {
      throw new NotFoundException('Suggestion not found');
    }

    // Get the from-version content
    const [fromVersion] = await this.db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.id, suggestion.fromVersionId))
      .limit(1);

    if (!fromVersion) {
      throw new NotFoundException('Source version not found');
    }

    // Get current version
    const [doc] = await this.db
      .select({
        currentVersionId: schema.documents.currentVersionId,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, suggestion.documentId))
      .limit(1);

    let currentVersion: { versionIndex: number; content: string } | null = null;
    if (doc?.currentVersionId) {
      const [curVer] = await this.db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, doc.currentVersionId))
        .limit(1);
      if (curVer) {
        currentVersion = {
          versionIndex: curVer.versionIndex,
          content: curVer.content,
        };
      }
    }

    // Generate diff: compare current version content with suggestion content
    const suggestionContent =
      suggestion.data.type === 'replace' ? suggestion.data.content : '';
    const baseContent = currentVersion?.content ?? fromVersion.content;
    const diff = diffLines(baseContent, suggestionContent);

    return {
      suggestion: this.toSuggestionResponse(suggestion),
      fromVersion: {
        versionIndex: fromVersion.versionIndex,
        content: fromVersion.content,
      },
      currentVersion,
      diff,
      isOutdated: suggestion.fromVersionId !== doc?.currentVersionId,
    };
  }

  async reviewSuggestion(
    suggestionId: string,
    action: 'approve' | 'reject',
    identity: DocumentIdentity,
  ): Promise<SuggestionResponse> {
    const [suggestion] = await this.db
      .select()
      .from(schema.documentSuggestions)
      .where(eq(schema.documentSuggestions.id, suggestionId))
      .limit(1);

    if (!suggestion) {
      throw new NotFoundException('Suggestion not found');
    }

    if (suggestion.status !== 'pending') {
      throw new ForbiddenException('Suggestion has already been reviewed');
    }

    const doc = await this.getDocOrThrow(suggestion.documentId);
    this.assertPermission(doc, identity, ['owner']);

    if (action === 'reject') {
      const [updated] = await this.db
        .update(schema.documentSuggestions)
        .set({
          status: 'rejected',
          reviewedBy: identity,
          reviewedAt: new Date(),
        })
        .where(eq(schema.documentSuggestions.id, suggestionId))
        .returning();

      return this.toSuggestionResponse(updated);
    }

    // Approve: create new version from suggestion content
    const suggestionContent =
      suggestion.data.type === 'replace' ? suggestion.data.content : '';

    // Get max versionIndex
    const [maxVer] = await this.db
      .select({ versionIndex: schema.documentVersions.versionIndex })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, suggestion.documentId))
      .orderBy(desc(schema.documentVersions.versionIndex))
      .limit(1);

    const nextVersionIndex = (maxVer?.versionIndex ?? 0) + 1;
    const versionId = uuidv7();

    // Create new version
    await this.db.insert(schema.documentVersions).values({
      id: versionId,
      documentId: suggestion.documentId,
      versionIndex: nextVersionIndex,
      content: suggestionContent,
      summary:
        suggestion.summary ??
        `Applied suggestion from ${suggestion.suggestedBy.type}`,
      updatedBy: identity,
    });

    // Update document currentVersionId
    await this.db
      .update(schema.documents)
      .set({
        currentVersionId: versionId,
        updatedAt: new Date(),
      })
      .where(eq(schema.documents.id, suggestion.documentId));

    // Update suggestion status
    const [updated] = await this.db
      .update(schema.documentSuggestions)
      .set({
        status: 'approved',
        reviewedBy: identity,
        reviewedAt: new Date(),
        resultVersionId: versionId,
      })
      .where(eq(schema.documentSuggestions.id, suggestionId))
      .returning();

    return this.toSuggestionResponse(updated);
  }

  // ── Permission helpers ──────────────────────────────────────────

  checkPermission(
    doc: schema.Document,
    identity: DocumentIdentity,
    requiredRoles: string[],
  ): boolean {
    return doc.privileges.some(
      (p) =>
        this.matchIdentity(p.identity, identity) &&
        requiredRoles.includes(p.role),
    );
  }

  private assertPermission(
    doc: schema.Document,
    identity: DocumentIdentity,
    requiredRoles: string[],
  ): void {
    if (!this.checkPermission(doc, identity, requiredRoles)) {
      throw new ForbiddenException(
        'You do not have permission to perform this action',
      );
    }
  }

  private matchIdentity(
    privilege: DocumentIdentity,
    caller: DocumentIdentity,
  ): boolean {
    if (privilege.type === 'user' && caller.type === 'user') {
      return privilege.id === caller.id;
    }
    if (privilege.type === 'bot' && caller.type === 'bot') {
      return privilege.id === caller.id;
    }
    if (privilege.type === 'workspace') {
      if (privilege.userType === 'all') return true;
      return privilege.userType === caller.type;
    }
    return false;
  }

  // ── Internal helpers ────────────────────────────────────────────

  private async getDocOrThrow(id: string): Promise<schema.Document> {
    const [doc] = await this.db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, id))
      .limit(1);

    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    return doc;
  }

  private toSuggestionResponse(
    s: schema.DocumentSuggestion,
  ): SuggestionResponse {
    return {
      id: s.id,
      documentId: s.documentId,
      fromVersionId: s.fromVersionId,
      suggestedBy: s.suggestedBy,
      data: s.data,
      summary: s.summary,
      status: s.status,
      reviewedBy: s.reviewedBy,
      reviewedAt: s.reviewedAt,
      resultVersionId: s.resultVersionId,
      createdAt: s.createdAt,
    };
  }
}
