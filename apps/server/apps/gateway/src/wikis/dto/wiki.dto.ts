export interface WikiDto {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  icon: string | null;
  approvalMode: 'auto' | 'review';
  humanPermission: 'read' | 'propose' | 'write';
  agentPermission: 'read' | 'propose' | 'write';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
