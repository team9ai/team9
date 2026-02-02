import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Users,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Home,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import workspaceApi from "@/services/api/workspace";
import { workspaceActions } from "@/stores";
import { useState, useEffect, useRef } from "react";

export const Route = createFileRoute("/invite/$code")({
  component: InvitePage,
});

function InvitePage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation("workspace");
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [workspaceFull, setWorkspaceFull] = useState(false);
  const autoAcceptTriggered = useRef(false);

  const token = localStorage.getItem("auth_token");

  const { data: inviteInfo, isLoading } = useQuery({
    queryKey: ["invitation", code],
    queryFn: () => workspaceApi.getInvitationInfo(code),
  });

  const acceptMutation = useMutation({
    mutationFn: () => workspaceApi.acceptInvitation(code),
    onSuccess: async (data) => {
      workspaceActions.setSelectedWorkspaceId(data.workspace.id);
      await queryClient.invalidateQueries({ queryKey: ["user-workspaces"] });
      navigate({ to: "/" });
    },
    onError: (error: any) => {
      console.error("Failed to accept invitation:", error);
      const msg = error?.message || error?.response?.data?.message || "";
      if (msg.includes("maximum") || msg.includes("member limit")) {
        setWorkspaceFull(true);
      } else if (msg.includes("already a member")) {
        setAlreadyMember(true);
      }
    },
  });

  // Auto-accept for logged-in users
  useEffect(() => {
    if (token && inviteInfo?.isValid && !autoAcceptTriggered.current) {
      autoAcceptTriggered.current = true;
      acceptMutation.mutate();
    }
  }, [token, inviteInfo]);

  // Redirect unauthenticated users to register
  useEffect(() => {
    if (!token && !isLoading && inviteInfo?.isValid) {
      navigate({ to: "/register", search: { invite: code } });
    }
  }, [token, isLoading, inviteInfo, code, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading invitation...</p>
        </div>
      </div>
    );
  }

  if (!inviteInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10">
        <Card className="p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-destructive mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Invitation Not Found
          </h2>
          <p className="text-muted-foreground">
            This invitation link is invalid or has been removed.
          </p>
        </Card>
      </div>
    );
  }

  if (!inviteInfo.isValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10 p-4">
        <Card className="p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-warning mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Invalid Invitation
          </h2>
          <p className="text-muted-foreground mb-4">
            {inviteInfo.reason || "This invitation is no longer valid."}
          </p>
          {inviteInfo.workspaceName && (
            <p className="text-sm text-muted-foreground">
              Workspace:{" "}
              <span className="font-medium">{inviteInfo.workspaceName}</span>
            </p>
          )}
        </Card>
      </div>
    );
  }

  // Show "Workspace Full" state
  if (workspaceFull) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10 p-4">
        <Card className="p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {t("workspaceFull", { max: 1000 })}
          </h1>
          <p className="text-muted-foreground mb-6">
            {t("workspaceFullInvite")}
          </p>
          <Button
            onClick={() => navigate({ to: "/" })}
            variant="outline"
            size="lg"
            className="w-full"
          >
            <Home size={18} className="mr-2" />
            Go Home
          </Button>
        </Card>
      </div>
    );
  }

  // Show "Already a Member" state
  if (alreadyMember) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10 p-4">
        <Card className="p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-success" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            You're Already a Member!
          </h1>
          <p className="text-muted-foreground mb-6">
            You're already part of the{" "}
            <span className="font-semibold text-primary">
              {inviteInfo?.workspaceName}
            </span>{" "}
            workspace.
          </p>
          <Button
            onClick={() => navigate({ to: "/" })}
            className="w-full bg-primary hover:bg-primary/90"
            size="lg"
          >
            <Home size={18} className="mr-2" />
            Go to Workspace
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10 p-4">
      <Card className="p-8 max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Join Workspace
          </h1>
          <h2 className="text-xl font-semibold text-primary">
            {inviteInfo.workspaceName}
          </h2>
        </div>

        {/* Invitation Details */}
        <div className="space-y-3 mb-6">
          {inviteInfo.invitedBy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users size={16} />
              <span>
                Invited by{" "}
                <span className="font-medium">{inviteInfo.invitedBy}</span>
              </span>
            </div>
          )}

          {inviteInfo.expiresAt && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar size={16} />
              <span>
                Expires {new Date(inviteInfo.expiresAt).toLocaleDateString()}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-3">
          {token ? (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3" />
              <p className="text-muted-foreground">Joining workspace...</p>
            </div>
          ) : (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-3" />
              <p className="text-muted-foreground">
                Redirecting to registration...
              </p>
            </div>
          )}
        </div>

        {acceptMutation.isError && !alreadyMember && !workspaceFull && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive text-center">
              Failed to accept invitation. Please try again or contact the
              workspace administrator.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
