import { useState } from "react";
import { Hash, Lock, Users, Settings, Trash2, Edit2, X } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  useChannel,
  useChannelMembers,
  useUpdateChannel,
} from "@/hooks/useChannels";
import { DeleteChannelDialog } from "@/components/dialog/DeleteChannelDialog";
import type { MemberRole } from "@/types/im";

interface ChannelSettingsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  currentUserRole?: MemberRole;
}

export function ChannelSettingsSheet({
  isOpen,
  onClose,
  channelId,
  currentUserRole = "member",
}: ChannelSettingsSheetProps) {
  const { data: channel } = useChannel(channelId);
  const { data: members = [] } = useChannelMembers(channelId);
  const updateChannel = useUpdateChannel();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";
  const isOwner = currentUserRole === "owner";

  const handleStartEdit = () => {
    if (!channel) return;
    setEditName(channel.name);
    setEditDescription(channel.description || "");
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!channel) return;

    try {
      await updateChannel.mutateAsync({
        channelId: channel.id,
        data: {
          name: editName !== channel.name ? editName : undefined,
          description:
            editDescription !== channel.description
              ? editDescription
              : undefined,
        },
      });
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update channel:", error);
    }
  };

  if (!channel) return null;

  const ChannelIcon = channel.type === "private" ? Lock : Hash;

  return (
    <>
      <Sheet open={isOpen} onOpenChange={onClose} side="right">
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2">
              <ChannelIcon size={20} className="text-slate-600" />
              <h2 className="text-lg font-semibold">#{channel.name}</h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 hover:bg-slate-100 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-6">
              {/* Channel Info Section */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold flex items-center gap-2 text-slate-700">
                    <Settings size={16} />
                    About this channel
                  </h3>
                  {isAdmin && !isEditing && (
                    <Button variant="ghost" size="sm" onClick={handleStartEdit}>
                      <Edit2 size={14} className="mr-1" />
                      Edit
                    </Button>
                  )}
                </div>

                {isEditing ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Channel name</Label>
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Textarea
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        rows={3}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleSaveEdit}
                        disabled={updateChannel.isPending}
                      >
                        {updateChannel.isPending ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIsEditing(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm text-slate-500">Name</p>
                      <p className="font-medium">#{channel.name}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Description</p>
                      <p className="text-slate-700">
                        {channel.description || "No description"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Type</p>
                      <p className="flex items-center gap-1">
                        {channel.type === "private" ? (
                          <>
                            <Lock size={14} /> Private
                          </>
                        ) : (
                          <>
                            <Hash size={14} /> Public
                          </>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Created</p>
                      <p>{new Date(channel.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                )}
              </section>

              <Separator />

              {/* Members Section */}
              <section className="space-y-4">
                <h3 className="font-semibold flex items-center gap-2 text-slate-700">
                  <Users size={16} />
                  Members ({members.length})
                </h3>
                <div className="space-y-2">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="w-8 h-8">
                          {member.user?.avatarUrl && (
                            <AvatarImage src={member.user.avatarUrl} />
                          )}
                          <AvatarFallback className="bg-purple-100 text-purple-700">
                            {(member.user?.displayName ||
                              member.user?.username ||
                              "U")[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">
                            {member.user?.displayName || member.user?.username}
                          </p>
                          <p className="text-xs text-slate-500">
                            {member.role}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Danger Zone */}
              {isOwner && (
                <>
                  <Separator />
                  <section className="space-y-4">
                    <h3 className="font-semibold text-red-600">Danger Zone</h3>
                    <Button
                      variant="outline"
                      className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      <Trash2 size={16} className="mr-2" />
                      Delete this channel
                    </Button>
                  </section>
                </>
              )}
            </div>
          </ScrollArea>
        </div>
      </Sheet>

      {/* Delete Confirmation Dialog */}
      {channel && (
        <DeleteChannelDialog
          isOpen={showDeleteDialog}
          onClose={() => setShowDeleteDialog(false)}
          channel={channel}
          onDeleted={onClose}
        />
      )}
    </>
  );
}
