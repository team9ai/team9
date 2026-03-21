import { useState } from "react";
import { emit } from "@/services/debug-socket";
import { useConnectionStore } from "@/stores/connection";

const PRESETS: { label: string; eventName: string; payload: string }[] = [
  {
    label: "Join Channel",
    eventName: "join_channel",
    payload: '{\n  "channelId": ""\n}',
  },
  {
    label: "Leave Channel",
    eventName: "leave_channel",
    payload: '{\n  "channelId": ""\n}',
  },
  {
    label: "Mark as Read",
    eventName: "mark_as_read",
    payload: '{\n  "channelId": "",\n  "messageId": ""\n}',
  },
  {
    label: "Add Reaction",
    eventName: "add_reaction",
    payload: '{\n  "messageId": "",\n  "emoji": "\ud83d\udc4d"\n}',
  },
  {
    label: "Typing Start",
    eventName: "typing_start",
    payload: '{\n  "channelId": ""\n}',
  },
];

export function JsonEditor() {
  const status = useConnectionStore((s) => s.status);
  const disabled = status !== "connected";
  const [eventName, setEventName] = useState("");
  const [payload, setPayload] = useState("{}");
  const [error, setError] = useState<string | null>(null);

  const handleSend = () => {
    try {
      const parsed = JSON.parse(payload);
      setError(null);
      emit(eventName, parsed);
    } catch (e) {
      setError("Invalid JSON");
    }
  };

  const applyPreset = (preset: (typeof PRESETS)[0]) => {
    setEventName(preset.eventName);
    setPayload(preset.payload);
    setError(null);
  };

  return (
    <div className="p-3 space-y-3 text-xs">
      <div>
        <label className="text-[10px] text-slate-500 block mb-1">Presets</label>
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className="px-1.5 py-0.5 text-[10px] border border-slate-700 rounded hover:bg-slate-800"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-[10px] text-slate-500 block mb-1">
          Event Name
        </label>
        <input
          className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200 focus:border-sky-500 focus:outline-none"
          placeholder="e.g. join_channel"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          disabled={disabled}
        />
      </div>

      <div>
        <label className="text-[10px] text-slate-500 block mb-1">
          Payload (JSON)
        </label>
        <textarea
          className={`w-full bg-slate-950 border rounded px-2 py-1.5 text-xs font-mono text-slate-200 resize-y h-48 focus:outline-none ${
            error ? "border-red-500" : "border-slate-700 focus:border-sky-500"
          }`}
          value={payload}
          onChange={(e) => {
            setPayload(e.target.value);
            setError(null);
          }}
          disabled={disabled}
          spellCheck={false}
        />
        {error && (
          <div className="text-red-400 text-[10px] mt-0.5">{error}</div>
        )}
      </div>

      <button
        onClick={handleSend}
        disabled={disabled || !eventName}
        className="w-full py-1.5 bg-sky-700 rounded hover:bg-sky-600 disabled:opacity-40"
      >
        Send Event
      </button>
    </div>
  );
}
