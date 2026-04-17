import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { HomeSubSidebar } from "../HomeSubSidebar";

const mockDirectChannels = vi.hoisted(() => [
  {
    id: "dm-claude",
    unreadCount: 0,
    otherUser: {
      id: "bot-claude",
      displayName: "Claude",
      username: "claude_bot_workspace",
      avatarUrl: null,
      status: "online",
      userType: "bot",
    },
  },
]);

class MockImage {
  complete = true;

  naturalWidth = 1;

  src = "";

  referrerPolicy = "";

  crossOrigin: string | null = null;

  addEventListener() {}

  removeEventListener() {}
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannelsByType: () => ({
    publicChannels: [],
    privateChannels: [],
    directChannels: mockDirectChannels,
    isLoading: false,
  }),
  usePublicChannels: () => ({
    data: [],
    isLoading: false,
  }),
  useSetSidebarVisibility: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}));

vi.mock("@/hooks/useSections", () => ({
  useSections: () => ({
    data: [],
  }),
  useMoveChannel: () => ({
    mutate: vi.fn(),
  }),
  useDeleteSection: () => ({
    mutate: vi.fn(),
  }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useUserWorkspaces: () => ({
    data: [{ id: "ws-1", name: "winrey's Workspace" }],
  }),
}));

vi.mock("@/stores", () => ({
  useSelectedWorkspaceId: () => "ws-1",
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <a className={className}>{children}</a>,
  useParams: () => ({}),
}));

vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: {},
  useSensor: () => ({}),
  useSensors: () => [],
  PointerSensor: class {},
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
  }),
  useDroppable: () => ({
    setNodeRef: vi.fn(),
    isOver: false,
  }),
}));

vi.mock("@/hooks/useIMUsers", () => ({
  useIsUserOnline: vi.fn(() => false),
}));

vi.mock("@/components/dialog/NewMessageDialog", () => ({
  NewMessageDialog: () => null,
}));

vi.mock("@/components/dialog/CreateChannelDialog", () => ({
  CreateChannelDialog: () => null,
}));

vi.mock("@/components/dialog/CreateSectionDialog", () => ({
  CreateSectionDialog: () => null,
}));

vi.mock("@/components/workspace/InviteManagementDialog", () => ({
  InviteManagementDialog: () => null,
}));

describe("HomeSubSidebar", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", MockImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders direct message avatars at the default sidebar size", () => {
    render(<HomeSubSidebar />);

    expect(
      screen
        .getByRole("img", { name: "Claude" })
        .closest("[data-slot='avatar']"),
    ).toHaveClass("w-9", "h-9");
  });
});
