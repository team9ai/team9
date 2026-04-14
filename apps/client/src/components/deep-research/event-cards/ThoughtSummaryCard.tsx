export interface ThoughtSummaryCardProps {
  seq: string;
  text: string;
}

export function ThoughtSummaryCard({ text }: ThoughtSummaryCardProps) {
  return (
    <div className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
      {text}
    </div>
  );
}
