import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());
const mockLogout = vi.hoisted(() => vi.fn());
const mockUpdateStatus = vi.hoisted(() => vi.fn());
const mockSetSelectedWorkspaceId = vi.hoisted(() => vi.fn());
const mockResetAHand = vi.hoisted(() => vi.fn());
const mockChangeLanguage = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: (namespace: string) => {
    const translations = {
      navigation: {
        home: "Home",
        dms: "DMs",
        activity: "Activity",
        aiStaff: "AI Staff",
        routines: "Routines",
        skills: "Skills",
        resources: "Resources",
        wiki: "Library",
        application: "Applications",
        more: "More",
        createWorkspace: "Create workspace",
        moreWorkspaces: "More workspaces",
        noWorkspace: "No workspace",
      },
      settings: {
        profile: "Profile",
        updateStatus: "Update your status",
        pauseNotifications: "Pause notifications",
        preferences: "Preferences",
        language: "Language",
        "status.online": "Online",
        "status.offline": "Offline",
        "status.away": "Away",
        "status.busy": "Busy",
      },
      common: {
        on: "On",
      },
    } as const;

    return {
      t: (key: string, options?: { status?: string; workspace?: string }) => {
        if (namespace === "settings" && key === "setStatus") {
          return `Set as ${options?.status ?? ""}`.trim();
        }

        if (namespace === "auth" && key === "signOutFrom") {
          return `Sign out of ${options?.workspace ?? "Workspace"}`;
        }

        return (
          translations[namespace as keyof typeof translations]?.[
            key as keyof (typeof translations)[keyof typeof translations]
          ] ?? key
        );
      },
      i18n: {
        language: "en",
        changeLanguage: mockChangeLanguage,
      },
    };
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: "/channels" }),
}));

vi.mock("@/i18n", () => ({
  supportedLanguages: [
    { code: "en", nativeName: "English" },
    { code: "zh-CN", nativeName: "简体中文" },
  ],
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useUserWorkspaces: () => ({
    data: [{ id: "ws-1", name: "winrey's Workspace" }],
    isLoading: false,
  }),
}));

vi.mock("@/stores", () => ({
  useWorkspaceStore: () => ({
    selectedWorkspaceId: "ws-1",
    setSelectedWorkspaceId: mockSetSelectedWorkspaceId,
  }),
  appActions: {
    resetNavigationForWorkspaceEntry: vi.fn(),
    setActiveSidebar: vi.fn(),
  },
  getLastVisitedPath: vi.fn((section: string) =>
    section === "home" ? "/channels" : `/${section}`,
  ),
  getSectionFromPath: vi.fn(() => "home"),
  useSidebarCollapsed: () => false,
}));

vi.mock("@/hooks/useAuth", () => ({
  useCurrentUser: () => ({
    data: {
      id: "user-1",
      displayName: "winrey",
      username: "winrey",
      avatarUrl: null,
    },
  }),
  useLogout: () => ({
    mutate: mockLogout,
  }),
}));

vi.mock("@/hooks/useIMUsers", () => ({
  useUpdateStatus: () => ({
    mutate: mockUpdateStatus,
  }),
  useOnlineUsers: () => ({
    data: { "user-1": "online" },
  }),
}));

vi.mock("@/hooks/useNotifications", () => ({
  useNotificationCounts: () => ({
    data: {
      total: 0,
      byType: { dm_received: 0 },
    },
  }),
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannelsByType: () => ({
    directChannels: [],
  }),
}));

vi.mock("@/hooks/useDevtools", () => ({
  useDevtools: () => ({
    handleTap: vi.fn(),
    message: null,
  }),
}));

vi.mock("@/stores/useAHandSetupStore", () => ({
  useAHandSetupStore: {
    getState: () => ({
      reset: mockResetAHand,
    }),
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    className,
    onClick,
    title,
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
    title?: string;
  }) => (
    <button type="button" className={className} onClick={onClick} title={title}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
  AvatarFallback: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

vi.mock("@/components/ui/user-avatar", () => ({
  UserAvatar: ({
    name,
    username,
    className,
    onClick,
  }: {
    name?: string;
    username?: string;
    className?: string;
    onClick?: () => void;
  }) => (
    <button type="button" className={className} onClick={onClick}>
      {name ?? username ?? "User"}
    </button>
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <div role="separator" />,
}));

vi.mock("@/components/ui/badge", () => ({
  NotificationBadge: () => null,
}));

vi.mock("@/components/dialog/CreateWorkspaceDialog", () => ({
  CreateWorkspaceDialog: () => null,
}));

import { MainSidebar } from "../MainSidebar";

function renderSidebar() {
  const queryClient = new QueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <MainSidebar />
    </QueryClientProvider>,
  );
}

describe("MainSidebar user menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides the temporary menu entries from the user popover", () => {
    renderSidebar();

    expect(screen.queryByText("Update your status")).not.toBeInTheDocument();
    expect(screen.queryByText("Set as Offline")).not.toBeInTheDocument();
    expect(screen.queryByText("Pause notifications")).not.toBeInTheDocument();
    expect(screen.queryByText("Preferences")).not.toBeInTheDocument();
    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.getAllByText("English").length).toBeGreaterThan(0);
  });

  it("keeps the workspace rail background draggable in desktop builds", () => {
    const { container } = renderSidebar();

    const workspaceRail = container.querySelector(
      "aside[data-tauri-drag-region]",
    );
    expect(workspaceRail).not.toBeNull();
    expect(
      workspaceRail?.querySelectorAll("[data-tauri-drag-region]").length,
    ).toBeGreaterThanOrEqual(2);
  });
});
