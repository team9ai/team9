import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Search,
  MoreVertical,
  Crown,
  ShieldCheck,
  User,
  UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useWorkspaceMembers,
  useCurrentWorkspaceRole,
  useUpdateMemberRole,
  useRemoveMember,
} from "@/hooks/useWorkspace";
import { useWorkspaceStore } from "@/stores";
import { formatDistanceToNow } from "@/lib/date-utils";
import type { WorkspaceMember } from "@/types/workspace";

export const Route = createFileRoute("/_authenticated/more/members")({
  component: MembersPage,
});

const roleIcons = {
  owner: Crown,
  admin: ShieldCheck,
  member: User,
  guest: UserX,
};

const roleLabels = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};

function MembersPage() {
  const { t } = useTranslation("workspace");
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const { selectedWorkspaceId } = useWorkspaceStore();
  const { isOwner } = useCurrentWorkspaceRole();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useWorkspaceMembers(selectedWorkspaceId || undefined, {
      search,
      limit: 20,
    });

  const updateMemberRole = useUpdateMemberRole(
    selectedWorkspaceId || undefined,
  );
  const removeMember = useRemoveMember(selectedWorkspaceId || undefined);

  // Flatten paginated results
  const members = data?.pages.flatMap((page) => page.members) || [];

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    if (!scrollRef.current || !hasNextPage || isFetchingNextPage) return;

    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    if (scrollHeight - scrollTop <= clientHeight * 1.5) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleRoleChange = async (
    member: WorkspaceMember,
    newRole: "admin" | "member" | "guest",
  ) => {
    if (!isOwner) {
      alert(
        t(
          "insufficientPermissions",
          "You don't have permission to change member roles",
        ),
      );
      return;
    }

    if (member.role === "owner") {
      alert(t("cannotChangeOwnerRole", "Cannot change the owner's role"));
      return;
    }

    try {
      await updateMemberRole.mutateAsync({
        userId: member.userId,
        role: newRole,
      });
    } catch (error: any) {
      alert(error?.response?.data?.message || "Failed to update role");
    }
  };

  const handleRemoveMember = async (member: WorkspaceMember) => {
    if (!isOwner) {
      alert(
        t(
          "insufficientPermissions",
          "You don't have permission to remove members",
        ),
      );
      return;
    }

    if (member.role === "owner") {
      alert(t("cannotRemoveOwner", "Cannot remove the workspace owner"));
      return;
    }

    if (
      confirm(
        t("confirmRemoveMember", {
          name: member.displayName || member.username,
          defaultValue: `Are you sure you want to remove ${member.displayName || member.username} from this workspace?`,
        }),
      )
    ) {
      try {
        await removeMember.mutateAsync(member.userId);
      } catch (error: any) {
        alert(error?.response?.data?.message || "Failed to remove member");
      }
    }
  };

  const getRoleIcon = (role: WorkspaceMember["role"]) => {
    const Icon = roleIcons[role];
    return Icon ? <Icon size={14} /> : null;
  };

  return (
    <main className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <header className="h-14 bg-background flex items-center gap-3 px-4 border-b">
        <Link to="/more">
          <Button variant="ghost" size="icon">
            <ArrowLeft size={20} />
          </Button>
        </Link>
        <h1 className="text-lg font-semibold">{t("members", "Members")}</h1>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col p-6 gap-4">
        {/* Search */}
        <div className="relative max-w-md">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground"
            size={18}
          />
          <Input
            placeholder={t("searchMembers", "Search members...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Members List */}
        <ScrollArea
          className="flex-1"
          onScroll={handleScroll}
          //@ts-ignore
          ref={scrollRef}
        >
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("common:loading", "Loading...")}
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {search
                ? t("noMembersFound", "No members found")
                : t("noMembers", "No members in this workspace")}
            </div>
          ) : (
            <div className="space-y-2 max-w-4xl">
              {members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4 rounded-lg hover:bg-accent/50 transition-colors border"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Avatar className="w-10 h-10">
                      {member.avatarUrl && (
                        <AvatarImage src={member.avatarUrl} />
                      )}
                      <AvatarFallback className="bg-primary/10 text-primary">
                        {(member.displayName || member.username)
                          .charAt(0)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {member.displayName || member.username}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">
                        @{member.username}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t("joined", "Joined")}{" "}
                        {formatDistanceToNow(new Date(member.joinedAt))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Role Badge */}
                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent text-sm">
                      {getRoleIcon(member.role)}
                      <span className="font-medium">
                        {roleLabels[member.role]}
                      </span>
                    </div>

                    {/* Actions Menu (only for owner) */}
                    {isOwner && member.role !== "owner" && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical size={16} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {member.role !== "admin" && (
                            <DropdownMenuItem
                              onClick={() => handleRoleChange(member, "admin")}
                            >
                              <ShieldCheck size={16} className="mr-2" />
                              {t("makeAdmin", "Make Admin")}
                            </DropdownMenuItem>
                          )}
                          {member.role !== "member" && (
                            <DropdownMenuItem
                              onClick={() => handleRoleChange(member, "member")}
                            >
                              <User size={16} className="mr-2" />
                              {t("makeMember", "Make Member")}
                            </DropdownMenuItem>
                          )}
                          {member.role !== "guest" && (
                            <DropdownMenuItem
                              onClick={() => handleRoleChange(member, "guest")}
                            >
                              <UserX size={16} className="mr-2" />
                              {t("makeGuest", "Make Guest")}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => handleRemoveMember(member)}
                            className="text-destructive focus:text-destructive"
                          >
                            <UserX size={16} className="mr-2" />
                            {t("removeMember", "Remove from Workspace")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              ))}

              {isFetchingNextPage && (
                <div className="text-center py-4 text-muted-foreground text-sm">
                  {t("common:loadingMore", "Loading more...")}
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </div>
    </main>
  );
}
