import { useEffect } from "react";
import { Layout } from "@/components/Layout";
import { useConnectionStore } from "@/stores/connection";
import { ConnectionPanel } from "@/components/left/ConnectionPanel";
import { ChannelList } from "@/components/left/ChannelList";
import { BotInfo } from "@/components/left/BotInfo";
import { EventStream } from "@/components/center/EventStream";

function LeftPanel() {
  return (
    <>
      <ConnectionPanel />
      <ChannelList />
      <div className="flex-1" />
      <BotInfo />
    </>
  );
}

function RightPlaceholder() {
  return <div className="p-3 text-xs text-slate-500">Right panel</div>;
}

export function App() {
  const loadProfiles = useConnectionStore((s) => s.loadProfiles);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  return (
    <Layout
      left={<LeftPanel />}
      center={<EventStream />}
      right={<RightPlaceholder />}
    />
  );
}
