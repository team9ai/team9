import { useState, useEffect } from "react";
import {
  Hash,
  Lock,
  Settings,
  Trash2,
  Edit2,
  UserPlus,
  Search,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  useChannel,
  useChannelMembers,
  useUpdateChannel,
} from "@/hooks/useChannels";
import { DeleteChannelDialog } from "@/components/dialog/DeleteChannelDialog";
import { AddMemberDialog } from "./AddMemberDialog";
import { useUser } from "@/stores";
import type { MemberRole } from "@/types/im";

interface ChannelDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  currentUserRole?: MemberRole;
  defaultTab?: "about" | "members" | "settings";
}

export function ChannelDetailsModal({
  isOpen,
  onClose,
  channelId,
  currentUserRole = "member",
  defaultTab = "about",
}: ChannelDetailsModalProps) {
  const { data: channel } = useChannel(channelId);
  const { data: members = [] } = useChannelMembers(channelId);
  const updateChannel = useUpdateChannel();
  const currentUser = useUser();

  const [activeTab, setActiveTab] = useState(defaultTab);
  const [isEditing, setIsEditing] = useState(false);

  // Sync activeTab when defaultTab changes (e.g., clicking different buttons)
  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab);
    }
  }, [defaultTab, isOpen]);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showAddMemberDialog, setShowAddMemberDialog] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");

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

  const filteredMembers = members.filter((member) => {
    if (!memberSearch) return true;
    const name = member.user?.displayName || member.user?.username || "";
    return name.toLowerCase().includes(memberSearch.toLowerCase());
  });

  if (!channel) return null;

  const ChannelIcon = channel.type === "private" ? Lock : Hash;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="w-120 max-w-[90vw] h-200 max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-6 pt-6 pb-4">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <ChannelIcon size={20} className="text-slate-600" />
              <span>#{channel.name}</span>
            </DialogTitle>
          </div>

          {/* Tabs */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as typeof activeTab)}
            className="flex-1"
          >
            <div className="px-6">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="about">关于</TabsTrigger>
                <TabsTrigger value="members">成员 {members.length}</TabsTrigger>
                {isAdmin && <TabsTrigger value="settings">设置</TabsTrigger>}
              </TabsList>
            </div>

            <ScrollArea className="flex-1">
              {/* About Tab */}
              <TabsContent value="about" className="px-6 pb-6 mt-0">
                <div className="space-y-6 pt-4">
                  {isEditing ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>频道名称</Label>
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>描述</Label>
                        <Textarea
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          rows={3}
                          placeholder="添加频道描述..."
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleSaveEdit}
                          disabled={updateChannel.isPending}
                        >
                          {updateChannel.isPending ? "保存中..." : "保存"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setIsEditing(false)}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <h3 className="text-sm font-medium text-slate-500">
                            频道名称
                          </h3>
                          <p className="font-medium">#{channel.name}</p>
                        </div>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleStartEdit}
                          >
                            <Edit2 size={14} className="mr-1" />
                            编辑
                          </Button>
                        )}
                      </div>

                      <div className="space-y-1">
                        <h3 className="text-sm font-medium text-slate-500">
                          描述
                        </h3>
                        <p className="text-slate-700">
                          {channel.description || "暂无描述"}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <h3 className="text-sm font-medium text-slate-500">
                          类型
                        </h3>
                        <p className="flex items-center gap-1">
                          {channel.type === "private" ? (
                            <>
                              <Lock size={14} /> 私有频道
                            </>
                          ) : (
                            <>
                              <Hash size={14} /> 公开频道
                            </>
                          )}
                        </p>
                      </div>

                      <div className="space-y-1">
                        <h3 className="text-sm font-medium text-slate-500">
                          创建时间
                        </h3>
                        <p>
                          {new Date(channel.createdAt).toLocaleDateString(
                            "zh-CN",
                          )}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </TabsContent>

              {/* Members Tab */}
              <TabsContent value="members" className="px-6 pb-6 mt-0">
                <div className="space-y-4 pt-4">
                  {/* Search */}
                  <div className="relative">
                    <Search
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <Input
                      placeholder="查找成员"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  {/* Add Member Button */}
                  {isAdmin && (
                    <button
                      onClick={() => setShowAddMemberDialog(true)}
                      className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
                        <UserPlus size={18} className="text-blue-600" />
                      </div>
                      <span className="font-medium">添加人员</span>
                    </button>
                  )}

                  {/* Members List */}
                  <div className="space-y-1">
                    {filteredMembers.map((member) => {
                      const isCurrentUser = member.userId === currentUser?.id;
                      return (
                        <div
                          key={member.id}
                          className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50"
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="w-9 h-9">
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
                                {member.user?.displayName ||
                                  member.user?.username}
                                {isCurrentUser && (
                                  <span className="text-slate-500 font-normal">
                                    {" "}
                                    (你)
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                          {member.role !== "member" && (
                            <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">
                              {member.role === "owner"
                                ? "频道管理者"
                                : "管理员"}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </TabsContent>

              {/* Settings Tab */}
              {isAdmin && (
                <TabsContent value="settings" className="px-6 pb-6 mt-0">
                  <div className="space-y-6 pt-4">
                    <div className="flex items-center gap-3">
                      <Settings size={18} className="text-slate-500" />
                      <h3 className="font-medium">频道设置</h3>
                    </div>

                    {/* Danger Zone */}
                    {isOwner && (
                      <div className="space-y-4 p-4 border border-red-200 rounded-lg bg-red-50/50">
                        <h4 className="font-medium text-red-600">危险操作</h4>
                        <p className="text-sm text-slate-600">
                          删除频道后，所有消息和文件都将被永久删除，无法恢复。
                        </p>
                        <Button
                          variant="outline"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                          onClick={() => setShowDeleteDialog(true)}
                        >
                          <Trash2 size={16} className="mr-2" />
                          删除此频道
                        </Button>
                      </div>
                    )}
                  </div>
                </TabsContent>
              )}
            </ScrollArea>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      {channel && (
        <DeleteChannelDialog
          isOpen={showDeleteDialog}
          onClose={() => setShowDeleteDialog(false)}
          channel={channel}
          onDeleted={onClose}
        />
      )}

      {/* Add Member Dialog */}
      <AddMemberDialog
        isOpen={showAddMemberDialog}
        onClose={() => setShowAddMemberDialog(false)}
        channelId={channelId}
      />
    </>
  );
}
