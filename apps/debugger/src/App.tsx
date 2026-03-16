import { useEffect } from "react";
import { Layout } from "@/components/Layout";
import { useConnectionStore } from "@/stores/connection";
import { ConnectionPanel } from "@/components/left/ConnectionPanel";
import { ChannelList } from "@/components/left/ChannelList";
import { BotInfo } from "@/components/left/BotInfo";

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

function CenterPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
      Connect to a server to see events
    </div>
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
      center={<CenterPlaceholder />}
      right={<RightPlaceholder />}
    />
  );
}
