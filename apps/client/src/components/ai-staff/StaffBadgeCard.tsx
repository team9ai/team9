import { StaffBadgeCard2D } from "./StaffBadgeCard2D";

export interface StaffBadgeCardProps {
  displayName: string;
  roleTitle?: string;
  avatarUrl?: string;
  mentorName?: string;
  mentorAvatarUrl?: string;
  persona?: string;
  modelLabel?: string;
  selected?: boolean;
  onClick?: () => void;
}

export function StaffBadgeCard(props: StaffBadgeCardProps) {
  return <StaffBadgeCard2D {...props} />;
}
