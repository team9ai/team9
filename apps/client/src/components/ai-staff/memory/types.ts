// Shapes mirror the memo9 data model (type → subject → memory) so this demo
// UI can later be swapped onto the real @memo9/sdk without reshaping callers.

export interface MemoryType {
  name: string;
  description: string;
  externalIdSpec: string;
  isCustom: boolean;
}

export interface MemorySubject {
  id: string;
  type: string;
  externalId: string;
  name: string;
  description?: string;
}

export type ConnectionKind = "main" | "weak";

export interface MemoryConnection {
  kind: ConnectionKind;
  targetSubjectId?: string;
  targetMemoryId?: string;
  label?: string;
}

export interface MemoryRecord {
  id: string;
  title: string;
  markdown: string;
  source: string;
  holderSubjectIds: string[];
  connections: MemoryConnection[];
  createdAt: string;
}
