import { useTranslation } from "react-i18next";
import {
  Check,
  Clock,
  FileText,
  Globe,
  ShieldAlert,
  Terminal,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Outcome = "approved" | "denied" | "pending";

type MockEntry = {
  id: string;
  actor: string;
  icon: typeof Terminal;
  verbKey: "ranCommand" | "openedUrl" | "readFile" | "requestedPermission";
  target: string;
  timeKey: "minutesAgo" | "hoursAgo" | "yesterday";
  timeValue?: number;
  outcome: Outcome;
  sourceKey: "auto" | "userApproved" | "userDenied" | "awaitingApproval";
};

// Mocked rows — rewritten once the backend exposes ahand audit events.
// Keeping the actor/target as literal strings (not i18n) because they'll
// be real runtime data, not user-facing copy to translate.
const MOCK_ENTRIES: MockEntry[] = [
  {
    id: "1",
    actor: "Personal Staff",
    icon: Terminal,
    verbKey: "ranCommand",
    target: "ls ~/Projects",
    timeKey: "minutesAgo",
    timeValue: 2,
    outcome: "approved",
    sourceKey: "auto",
  },
  {
    id: "2",
    actor: "Personal Staff",
    icon: Globe,
    verbKey: "openedUrl",
    target: "github.com",
    timeKey: "minutesAgo",
    timeValue: 5,
    outcome: "approved",
    sourceKey: "auto",
  },
  {
    id: "3",
    actor: "Idea Curator",
    icon: ShieldAlert,
    verbKey: "requestedPermission",
    target: "Screen Recording",
    timeKey: "hoursAgo",
    timeValue: 1,
    outcome: "pending",
    sourceKey: "awaitingApproval",
  },
  {
    id: "4",
    actor: "Personal Staff",
    icon: FileText,
    verbKey: "readFile",
    target: "~/Documents/notes.md",
    timeKey: "hoursAgo",
    timeValue: 2,
    outcome: "approved",
    sourceKey: "userApproved",
  },
  {
    id: "5",
    actor: "acme-team Workspace",
    icon: Terminal,
    verbKey: "ranCommand",
    target: "npm install left-pad",
    timeKey: "yesterday",
    outcome: "denied",
    sourceKey: "userDenied",
  },
];

export function AuditLogTab() {
  const { t } = useTranslation("ahand");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("devicesTabs.auditDescription")}
      </p>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">
              {t("audit.recentTitle")}
            </CardTitle>
            <Badge
              variant="outline"
              size="sm"
              className="h-5 shrink-0 rounded-md border-border/60 bg-background/80 px-1.5 text-[10px] font-medium text-muted-foreground"
            >
              {t("comingSoon")}
            </Badge>
          </div>
          <CardDescription>{t("audit.recentDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <FilterBar />
          <div className="divide-y">
            {MOCK_ENTRIES.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterBar() {
  const { t } = useTranslation("ahand");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value="all" disabled>
        <SelectTrigger className="w-[160px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("audit.filterAgentAll")}</SelectItem>
        </SelectContent>
      </Select>
      <Select value="all" disabled>
        <SelectTrigger className="w-[160px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("audit.filterOutcomeAll")}</SelectItem>
        </SelectContent>
      </Select>
      <Select value="7d" disabled>
        <SelectTrigger className="w-[140px] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="7d">{t("audit.filterRange7d")}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function EntryRow({ entry }: { entry: MockEntry }) {
  const { t } = useTranslation("ahand");
  const Icon = entry.icon;
  const outcomeStyle = {
    approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
    denied: "border-rose-200 bg-rose-50 text-rose-700",
    pending: "border-amber-200 bg-amber-50 text-amber-700",
  }[entry.outcome];
  const OutcomeIcon = {
    approved: Check,
    denied: X,
    pending: Clock,
  }[entry.outcome];

  const timeLabel =
    entry.timeKey === "yesterday"
      ? t("audit.yesterday")
      : t(`audit.${entry.timeKey}` as const, { count: entry.timeValue ?? 0 });

  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">
          <span className="font-medium">{entry.actor}</span>
          <span className="text-muted-foreground">
            {" "}
            {t(`audit.verb.${entry.verbKey}` as const)}{" "}
          </span>
          <code className="text-xs bg-muted rounded px-1 py-0.5 font-mono">
            {entry.target}
          </code>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {timeLabel} · {t(`audit.source.${entry.sourceKey}` as const)}
        </p>
      </div>
      <Badge
        variant="outline"
        size="sm"
        className={cn(
          "h-5 shrink-0 rounded-md px-1.5 text-[10px] font-medium gap-1",
          outcomeStyle,
        )}
      >
        <OutcomeIcon className="h-3 w-3" />
        {t(`audit.outcome.${entry.outcome}` as const)}
      </Badge>
    </div>
  );
}
