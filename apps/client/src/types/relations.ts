/**
 * Types for message relation inspection and hierarchy tree views.
 */

export type RelationKind = "parent" | "related";

export interface OutgoingParentEdge {
  messageId: string;
  depth: number;
  propertyDefinitionId: string;
  parentSource: "relation" | "thread";
}

export interface OutgoingRelatedEdge {
  messageId: string;
  propertyDefinitionId: string;
}

export interface IncomingChildEdge {
  messageId: string;
  depth: number;
  propertyDefinitionId: string;
  parentSource: "relation" | "thread";
}

export interface IncomingRelatedEdge {
  messageId: string;
  propertyDefinitionId: string;
}

export interface RelationInspectionResult {
  outgoing: {
    parent: OutgoingParentEdge[];
    related: OutgoingRelatedEdge[];
  };
  incoming: {
    children: IncomingChildEdge[];
    relatedBy: IncomingRelatedEdge[];
  };
}

export interface TreeNode {
  messageId: string;
  effectiveParentId: string | null;
  parentSource: "relation" | "thread" | null;
  depth: number;
  hasChildren: boolean;
  /** Always false after a fresh fetch — children are loaded on expand. */
  childrenLoaded: boolean;
}

export interface TreeSnapshot {
  nodes: TreeNode[];
  nextCursor: string | null;
  ancestorsIncluded: string[];
}
