export interface MessageTitleProps {
  title: string | undefined;
  messageId: string;
}

export function MessageTitle({ title }: MessageTitleProps) {
  if (!title) return null;

  return (
    <div className="font-semibold text-base leading-snug mb-0.5">{title}</div>
  );
}
