import { useState } from "react";
import { useConnectionStore } from "@/stores/connection";
import { connect } from "@/services/debug-socket";

export function ConnectionPanel() {
  const {
    status,
    serverUrl,
    token,
    setServerUrl,
    setToken,
    profiles,
    saveProfile,
    deleteProfile,
    applyProfile,
  } = useConnectionStore();
  const [showProfiles, setShowProfiles] = useState(false);

  const isConnected = status === "connected";
  const canConnect = !isConnected && token.length > 0 && serverUrl.length > 0;

  const handleConnect = () => {
    if (canConnect) connect(serverUrl, token);
  };

  const handleSaveProfile = () => {
    const alias = prompt("Profile name:");
    if (alias) saveProfile({ alias, serverUrl, token });
  };

  return (
    <div className="flex flex-col">
      <div className="px-3 py-2 bg-slate-900 border-b border-slate-700 text-[10px] uppercase tracking-widest text-slate-500">
        Connection
      </div>
      <div className="p-3 space-y-2 border-b border-slate-700">
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">
            Server URL
          </label>
          <input
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 focus:border-sky-500 focus:outline-none"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:3000"
            disabled={isConnected}
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">
            Bot Token
          </label>
          <input
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 focus:border-sky-500 focus:outline-none"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="t9bot_..."
            disabled={isConnected}
          />
        </div>
        <div className="flex gap-1">
          <button
            onClick={handleConnect}
            disabled={!canConnect}
            className="flex-1 text-center text-xs py-1.5 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Connect
          </button>
          <button
            onClick={handleSaveProfile}
            className="text-xs px-2 py-1.5 rounded border border-slate-600 hover:bg-slate-800"
          >
            Save
          </button>
        </div>
      </div>

      {profiles.length > 0 && (
        <>
          <button
            onClick={() => setShowProfiles(!showProfiles)}
            className="px-3 py-2 bg-slate-900 border-b border-slate-700 text-[10px] uppercase tracking-widest text-slate-500 text-left hover:bg-slate-800 flex justify-between"
          >
            <span>Profiles ({profiles.length})</span>
            <span>{showProfiles ? "▼" : "▶"}</span>
          </button>
          {showProfiles &&
            profiles.map((p) => (
              <div
                key={p.id}
                className="px-3 py-2 border-b border-slate-800 flex items-center justify-between hover:bg-slate-900/50 cursor-pointer group"
                onClick={() => applyProfile(p.id)}
              >
                <div>
                  <div className="text-xs text-slate-200">{p.alias}</div>
                  <div className="text-[10px] text-slate-500 font-mono truncate max-w-[140px]">
                    {p.serverUrl}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteProfile(p.id);
                  }}
                  className="text-[10px] text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
