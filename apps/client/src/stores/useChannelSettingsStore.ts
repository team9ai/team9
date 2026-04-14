import { create } from "zustand";

export type ChannelSettingsTab =
  | "about"
  | "members"
  | "properties"
  | "settings";

interface ChannelSettingsState {
  isOpen: boolean;
  channelId: string | null;
  defaultTab: ChannelSettingsTab;
  openChannelSettings: (
    channelId: string,
    defaultTab?: ChannelSettingsTab,
  ) => void;
  closeChannelSettings: () => void;
}

export const useChannelSettingsStore = create<ChannelSettingsState>((set) => ({
  isOpen: false,
  channelId: null,
  defaultTab: "about",
  openChannelSettings: (channelId, defaultTab = "about") =>
    set({ isOpen: true, channelId, defaultTab }),
  closeChannelSettings: () => set({ isOpen: false }),
}));
