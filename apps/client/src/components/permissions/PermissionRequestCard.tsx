import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react";
import { ScopeEditor } from "./ScopeEditor";

export interface PermissionRequestSummary {
  id: string;
  spellId: string;
  permissionKey: string;
  requestedMetadata: Record<string, unknown>;
  reason?: string | null;
  contextChannelId?: string | null;
  contextExecutionId?: string | null;
  contextRoutineId?: string | null;
  requesterBotName?: string;
  expiresAt: string;
}

export interface DecideInput {
  decision: "once" | "remember" | "deny";
  scopeOverride?: Record<string, unknown>;
  rememberSubject?: "agent" | "channel-session" | "execution-session" | "task";
  expiresAt?: string;
  note?: string;
}

export interface PermissionRequestCardProps {
  request: PermissionRequestSummary;
  onDecide: (input: DecideInput) => void;
}

export function PermissionRequestCard({
  request,
  onDecide,
}: PermissionRequestCardProps) {
  const { t } = useTranslation("permissions");
  const [showRemember, setShowRemember] = useState(false);
  const [rememberSubject, setRememberSubject] = useState<
    DecideInput["rememberSubject"]
  >(request.contextChannelId ? "channel-session" : "agent");
  const [scope, setScope] = useState<Record<string, unknown>>(
    request.requestedMetadata,
  );
  const [expiresAt, setExpiresAt] = useState<string>("");

  return (
    <div className="rounded-md border bg-card p-3 shadow-sm space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {t("request.from", { bot: request.requesterBotName ?? "bot" })}
        </span>
        {request.contextChannelId && (
          <span>{t("request.in", { channel: request.contextChannelId })}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">
          {request.spellId}
        </code>
        <button
          type="button"
          aria-label={t("request.spellCopy")}
          onClick={() => navigator.clipboard?.writeText(request.spellId)}
          className="text-muted-foreground hover:text-foreground"
        >
          <Copy size={14} />
        </button>
      </div>

      <div className="text-sm">
        <strong>{request.permissionKey}</strong>
        {request.reason && (
          <p className="text-muted-foreground">{request.reason}</p>
        )}
      </div>

      {!showRemember ? (
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs"
            onClick={() => onDecide({ decision: "once" })}
          >
            {t("request.allowOnce")}
          </button>
          <button
            type="button"
            className="px-2 py-1 rounded border text-xs"
            onClick={() => setShowRemember(true)}
          >
            {t("request.remember")}
          </button>
          <button
            type="button"
            className="px-2 py-1 rounded text-destructive text-xs ml-auto"
            onClick={() => onDecide({ decision: "deny" })}
          >
            {t("request.deny")}
          </button>
        </div>
      ) : (
        <div className="space-y-2 border-t pt-2">
          <label className="block text-xs">
            <span>{t("remember.subjectLabel")}</span>
            <select
              aria-label={t("remember.subjectLabel")}
              value={rememberSubject}
              onChange={(e) =>
                setRememberSubject(
                  e.target.value as DecideInput["rememberSubject"],
                )
              }
              className="w-full"
            >
              <option value="agent">{t("remember.subjectAgent")}</option>
              <option
                value="channel-session"
                disabled={!request.contextChannelId}
              >
                {t("remember.subjectChannel")}
              </option>
              <option
                value="execution-session"
                disabled={!request.contextExecutionId}
              >
                {t("remember.subjectExecution")}
              </option>
              <option value="task" disabled={!request.contextRoutineId}>
                {t("remember.subjectTask")}
              </option>
            </select>
          </label>

          <label className="block text-xs">
            <span>{t("remember.expiresLabel")}</span>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full"
            />
          </label>

          <ScopeEditor
            permissionKey={request.permissionKey}
            value={scope}
            onChange={setScope}
          />

          <div className="flex gap-2">
            <button
              type="button"
              className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs"
              onClick={() =>
                onDecide({
                  decision: "remember",
                  rememberSubject,
                  scopeOverride: scope,
                  expiresAt: expiresAt
                    ? new Date(expiresAt).toISOString()
                    : undefined,
                })
              }
            >
              {t("remember.save")}
            </button>
            <button
              type="button"
              aria-label="←"
              className="px-2 py-1 rounded text-xs"
              onClick={() => setShowRemember(false)}
            >
              ←
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
