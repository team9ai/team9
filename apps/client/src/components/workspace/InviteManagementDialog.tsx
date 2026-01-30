import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Copy,
  Trash2,
  Check,
  Calendar,
  Users,
  Link2,
  AlertCircle,
} from "lucide-react";
import {
  useWorkspaceInvitations,
  useCreateInvitation,
  useRevokeInvitation,
} from "@/hooks/useWorkspace";
import { formatDistanceToNow } from "@/lib/date-utils";

interface InviteManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
}

export function InviteManagementDialog({
  isOpen,
  onClose,
  workspaceId,
}: InviteManagementDialogProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const { data: invitations = [], isLoading } =
    useWorkspaceInvitations(workspaceId);
  const createInvitation = useCreateInvitation(workspaceId);
  const revokeInvitation = useRevokeInvitation(workspaceId);

  // Form state
  const [formData, setFormData] = useState({
    role: "member" as "member" | "admin" | "guest",
    maxUses: "1",
    expiresInDays: "1",
  });

  const handleCreate = async () => {
    const data: any = {
      role: formData.role,
    };

    if (formData.maxUses) {
      data.maxUses = parseInt(formData.maxUses);
    }
    if (formData.expiresInDays) {
      data.expiresInDays = parseInt(formData.expiresInDays);
    }

    await createInvitation.mutateAsync(data);

    // Reset form
    setFormData({ role: "member", maxUses: "1", expiresInDays: "1" });
    setShowCreateForm(false);
  };

  const handleCopy = async (url: string, code: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleRevoke = async (code: string) => {
    if (confirm("Are you sure you want to revoke this invitation?")) {
      await revokeInvitation.mutateAsync(code);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Workspace Invitations</DialogTitle>
          <DialogDescription>
            Create and manage invitation links for your workspace
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Create Button */}
          {!showCreateForm && (
            <Button
              onClick={() => setShowCreateForm(true)}
              className="w-full"
              variant="outline"
            >
              <Plus size={16} className="mr-2" />
              Create New Invitation
            </Button>
          )}

          {/* Create Form */}
          {showCreateForm && (
            <div className="border rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Create New Invitation</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </Button>
              </div>

              <div className="space-y-3">
                <div>
                  <Label htmlFor="role">Role</Label>
                  <select
                    id="role"
                    value={formData.role}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        role: e.target.value as any,
                      })
                    }
                    className="w-full mt-1 px-3 py-2 border rounded-md"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    <option value="guest">Guest</option>
                  </select>
                </div>

                <div>
                  <Label htmlFor="maxUses">Max Uses (default: 1)</Label>
                  <Input
                    id="maxUses"
                    type="number"
                    min="1"
                    placeholder="1"
                    value={formData.maxUses}
                    onChange={(e) =>
                      setFormData({ ...formData, maxUses: e.target.value })
                    }
                  />
                </div>

                <div>
                  <Label htmlFor="expires">
                    Expires In (days, default: 1 day / 24 hours)
                  </Label>
                  <Input
                    id="expires"
                    type="number"
                    min="1"
                    placeholder="1"
                    value={formData.expiresInDays}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        expiresInDays: e.target.value,
                      })
                    }
                  />
                </div>

                <Button
                  onClick={handleCreate}
                  disabled={createInvitation.isPending}
                  className="w-full bg-primary hover:bg-primary/90"
                >
                  {createInvitation.isPending
                    ? "Creating..."
                    : "Create Invitation"}
                </Button>
              </div>
            </div>
          )}

          <Separator />

          {/* Invitations List */}
          <div className="flex-1 overflow-hidden">
            <h3 className="font-semibold mb-3">Active Invitations</h3>

            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading invitations...
              </div>
            ) : invitations.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Link2 className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No invitations yet</p>
                <p className="text-sm">
                  Create one to invite people to your workspace
                </p>
              </div>
            ) : (
              <ScrollArea className="h-[300px]">
                <div className="space-y-3">
                  {invitations.map((invitation) => (
                    <div
                      key={invitation.id}
                      className={`border rounded-lg p-4 ${
                        !invitation.isActive ? "opacity-50 bg-muted" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
                              {invitation.role.toUpperCase()}
                            </span>
                            {!invitation.isActive && (
                              <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded">
                                REVOKED
                              </span>
                            )}
                          </div>

                          <div className="text-sm space-y-1 text-muted-foreground">
                            {invitation.createdBy && (
                              <p>
                                Created by{" "}
                                {invitation.createdBy.displayName ||
                                  invitation.createdBy.username}
                              </p>
                            )}
                            <p>
                              Created{" "}
                              {formatDistanceToNow(
                                new Date(invitation.createdAt),
                              )}
                            </p>
                          </div>
                        </div>

                        {invitation.isActive && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                handleCopy(invitation.url, invitation.code)
                              }
                            >
                              {copiedCode === invitation.code ? (
                                <>
                                  <Check size={14} className="mr-1" />
                                  Copied
                                </>
                              ) : (
                                <>
                                  <Copy size={14} className="mr-1" />
                                  Copy Link
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRevoke(invitation.code)}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-3">
                        {invitation.maxUses ? (
                          <div className="flex items-center gap-1">
                            <Users size={12} />
                            <span>
                              {invitation.usedCount} / {invitation.maxUses} uses
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Users size={12} />
                            <span>{invitation.usedCount} uses (unlimited)</span>
                          </div>
                        )}

                        {invitation.expiresAt ? (
                          <div className="flex items-center gap-1">
                            <Calendar size={12} />
                            <span>
                              Expires{" "}
                              {new Date(
                                invitation.expiresAt,
                              ).toLocaleDateString()}
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Calendar size={12} />
                            <span>Never expires</span>
                          </div>
                        )}
                      </div>

                      {invitation.isActive && (
                        <div className="mt-3 p-2 bg-muted rounded text-xs font-mono break-all">
                          {invitation.url}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>

          {/* Info */}
          <div className="flex items-start gap-2 p-3 bg-info/10 border border-info/20 rounded-lg">
            <AlertCircle size={16} className="text-info mt-0.5" />
            <div className="text-xs text-info">
              <p className="font-medium mb-1">How it works:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>
                  Share the invitation link with people you want to invite
                </li>
                <li>They'll be asked to sign in or create an account</li>
                <li>
                  Once accepted, they'll join your workspace automatically
                </li>
              </ul>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
