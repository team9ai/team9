import { useEffect } from "react";
import { Layout } from "@/components/Layout";
import { useConnectionStore } from "@/stores/connection";

function LeftPlaceholder() {
  return <div className="p-3 text-xs text-slate-500">Left panel</div>;
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
      left={<LeftPlaceholder />}
      center={<CenterPlaceholder />}
      right={<RightPlaceholder />}
    />
  );
}
