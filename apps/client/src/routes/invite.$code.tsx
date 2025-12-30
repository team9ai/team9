import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Calendar, AlertCircle, CheckCircle2, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import workspaceApi from "@/services/api/workspace";
import { useState } from "react";

export const Route = createFileRoute("/invite/$code")({
  component: InvitePage,
});

function InvitePage() {
  const { code } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [alreadyMember, setAlreadyMember] = useState(false);

  const { data: inviteInfo, isLoading } = useQuery({
    queryKey: ["invitation", code],
    queryFn: () => workspaceApi.getInvitationInfo(code),
  });

  const acceptMutation = useMutation({
    mutationFn: () => workspaceApi.acceptInvitation(code),
    onSuccess: async () => {
      // Invalidate and refetch user workspaces query
      await queryClient.invalidateQueries({ queryKey: ["user-workspaces"] });
      // Wait a bit for the query to refetch
      await new Promise((resolve) => setTimeout(resolve, 100));
      navigate({ to: "/" });
    },
    onError: (error: any) => {
      console.error("Failed to accept invitation:", error);
      // Check if user is already a member
      if (
        error?.response?.data?.message?.includes("already a member") ||
        error?.response?.status === 400
      ) {
        setAlreadyMember(true);
      }
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-purple-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-4" />
          <p className="text-slate-600">Loading invitation...</p>
        </div>
      </div>
    );
  }

  if (!inviteInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-purple-100">
        <Card className="p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            Invitation Not Found
          </h2>
          <p className="text-slate-600">
            This invitation link is invalid or has been removed.
          </p>
        </Card>
      </div>
    );
  }

  if (!inviteInfo.isValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-purple-100 p-4">
        <Card className="p-8 max-w-md text-center">
          <AlertCircle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            Invalid Invitation
          </h2>
          <p className="text-slate-600 mb-4">
            {inviteInfo.reason || "This invitation is no longer valid."}
          </p>
          {inviteInfo.workspaceName && (
            <p className="text-sm text-slate-500">
              Workspace:{" "}
              <span className="font-medium">{inviteInfo.workspaceName}</span>
            </p>
          )}
        </Card>
      </div>
    );
  }

  const token = localStorage.getItem("auth_token");

  // Show "Already a Member" state
  if (alreadyMember) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-purple-100 p-4">
        <Card className="p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            You're Already a Member!
          </h1>
          <p className="text-slate-600 mb-6">
            You're already part of the{" "}
            <span className="font-semibold text-purple-600">
              {inviteInfo?.workspaceName}
            </span>{" "}
            workspace.
          </p>
          <Button
            onClick={() => navigate({ to: "/" })}
            className="w-full bg-purple-600 hover:bg-purple-700"
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-50 to-purple-100 p-4">
      <Card className="p-8 max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-8 h-8 text-purple-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            Join Workspace
          </h1>
          <h2 className="text-xl font-semibold text-purple-600">
            {inviteInfo.workspaceName}
          </h2>
        </div>

        {/* Invitation Details */}
        <div className="space-y-3 mb-6">
          {inviteInfo.invitedBy && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Users size={16} />
              <span>
                Invited by{" "}
                <span className="font-medium">{inviteInfo.invitedBy}</span>
              </span>
            </div>
          )}

          {inviteInfo.expiresAt && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
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
            <Button
              onClick={() => acceptMutation.mutate()}
              disabled={acceptMutation.isPending}
              className="w-full bg-purple-600 hover:bg-purple-700"
              size="lg"
            >
              {acceptMutation.isPending ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Joining...
                </>
              ) : (
                <>
                  <CheckCircle2 size={18} className="mr-2" />
                  Accept Invitation
                </>
              )}
            </Button>
          ) : (
            <>
              <Button
                onClick={() =>
                  navigate({
                    to: "/login",
                    search: { redirect: `/invite/${code}` },
                  })
                }
                className="w-full bg-purple-600 hover:bg-purple-700"
                size="lg"
              >
                Sign In to Accept
              </Button>
              <Button
                onClick={() =>
                  navigate({
                    to: "/register",
                    search: { redirect: `/invite/${code}` },
                  })
                }
                variant="outline"
                className="w-full"
                size="lg"
              >
                Create Account
              </Button>
            </>
          )}
        </div>

        {acceptMutation.isError && !alreadyMember && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600 text-center">
              Failed to accept invitation. Please try again or contact the
              workspace administrator.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
