export interface ProposalDto {
  id: string;
  wikiId: string;
  title: string;
  description: string;
  status: 'pending' | 'changes_requested' | 'approved' | 'rejected';
  authorId: string;
  authorType: 'user' | 'agent';
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}
