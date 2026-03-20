import { useState } from "react";
import { useConnectionStore } from "@/stores/connection";
import { emit } from "@/services/debug-socket";
import * as api from "@/services/api";
import { WS_EVENTS } from "@/lib/events";
import { nanoid } from "nanoid";

export function QuickActions() {
  const channels = useConnectionStore((s) => s.channels);
  const status = useConnectionStore((s) => s.status);
  const disabled = status !== "connected";

  // Send message state
  const [msgChannel, setMsgChannel] = useState("");
  const [msgContent, setMsgContent] = useState("");
  const [msgParentId, setMsgParentId] = useState("");
  const [sending, setSending] = useState(false);

  // Streaming state
  const [streamChannel, setStreamChannel] = useState("");
  const [streamContent, setStreamContent] = useState("");
  const [streamActive, setStreamActive] = useState(false);
  const [currentStreamId, setCurrentStreamId] = useState<string | null>(null);
  const [autoChunk, setAutoChunk] = useState(true);
  const [chunkInterval, setChunkInterval] = useState(500);
  const [includeThinking, setIncludeThinking] = useState(false);
  const [thinkingContent, setThinkingContent] = useState("");

  const handleSendMessage = async () => {
    if (!msgChannel || !msgContent) return;
    setSending(true);
    try {
      await api.sendMessage(msgChannel, msgContent, msgParentId || undefined);
      setMsgContent("");
      setMsgParentId("");
    } finally {
      setSending(false);
    }
  };

  const handleStartStream = async () => {
    if (!streamChannel) return;
    const streamId = nanoid();
    setCurrentStreamId(streamId);
    setStreamActive(true);

    emit(WS_EVENTS.STREAMING.START, {
      streamId,
      channelId: streamChannel,
    });

    if (autoChunk && streamContent) {
      // Auto-chunk mode: send thinking first if enabled, then split content
      if (includeThinking && thinkingContent) {
        emit(WS_EVENTS.STREAMING.THINKING_CONTENT, {
          streamId,
          channelId: streamChannel,
          content: thinkingContent,
        });
      }

      const words = streamContent.split(" ");
      let accumulated = "";
      for (let i = 0; i < words.length; i++) {
        accumulated += (i > 0 ? " " : "") + words[i];
        await new Promise((r) => setTimeout(r, chunkInterval));
        emit(WS_EVENTS.STREAMING.CONTENT, {
          streamId,
          channelId: streamChannel,
          content: accumulated,
        });
      }

      emit(WS_EVENTS.STREAMING.END, {
        streamId,
        channelId: streamChannel,
      });
      setStreamActive(false);
      setCurrentStreamId(null);
    }
    // In manual mode, user controls via End/Abort buttons
  };

  const handleEndStream = () => {
    if (!currentStreamId || !streamChannel) return;
    emit(WS_EVENTS.STREAMING.END, {
      streamId: currentStreamId,
      channelId: streamChannel,
    });
    setStreamActive(false);
    setCurrentStreamId(null);
  };

  const handleAbortStream = () => {
    if (!currentStreamId || !streamChannel) return;
    emit(WS_EVENTS.STREAMING.ABORT, {
      streamId: currentStreamId,
      channelId: streamChannel,
      reason: "cancelled",
    });
    setStreamActive(false);
    setCurrentStreamId(null);
  };

  const handleSendStreamChunk = () => {
    if (!currentStreamId || !streamChannel || !streamContent) return;
    emit(WS_EVENTS.STREAMING.CONTENT, {
      streamId: currentStreamId,
      channelId: streamChannel,
      content: streamContent,
    });
  };

  const ChannelSelect = ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <select
      className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">Select channel...</option>
      {channels.map((ch) => (
        <option key={ch.id} value={ch.id}>
          {ch.type === "direct" ? "DM" : "#"} {ch.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="p-3 space-y-4 text-xs">
      {/* Send Message */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
          Send Message (REST)
        </div>
        <div className="space-y-1.5">
          <ChannelSelect value={msgChannel} onChange={setMsgChannel} />
          <textarea
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 resize-y h-12"
            placeholder="Message content..."
            value={msgContent}
            onChange={(e) => setMsgContent(e.target.value)}
            disabled={disabled}
          />
          <input
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono text-slate-200"
            placeholder="Parent ID (optional, for threads)"
            value={msgParentId}
            onChange={(e) => setMsgParentId(e.target.value)}
            disabled={disabled}
          />
          <button
            onClick={handleSendMessage}
            disabled={disabled || !msgChannel || !msgContent || sending}
            className="w-full py-1.5 bg-sky-700 rounded hover:bg-sky-600 disabled:opacity-40"
          >
            {sending ? "Sending..." : "Send Message"}
          </button>
        </div>
      </div>

      {/* Streaming */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
          Streaming (WebSocket)
        </div>
        <div className="space-y-1.5">
          <ChannelSelect value={streamChannel} onChange={setStreamChannel} />
          {includeThinking && (
            <textarea
              className="w-full bg-slate-950 border border-purple-700/50 rounded px-2 py-1.5 text-xs font-mono text-purple-300 resize-y h-10"
              placeholder="Thinking content..."
              value={thinkingContent}
              onChange={(e) => setThinkingContent(e.target.value)}
              disabled={disabled || streamActive}
            />
          )}
          <textarea
            className="w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 resize-y h-16"
            placeholder="Streaming content..."
            value={streamContent}
            onChange={(e) => setStreamContent(e.target.value)}
            disabled={disabled}
          />
          <div className="flex gap-1">
            {!streamActive ? (
              <button
                onClick={handleStartStream}
                disabled={disabled || !streamChannel}
                className="flex-1 py-1.5 bg-amber-700 rounded hover:bg-amber-600 disabled:opacity-40"
              >
                Start Stream
              </button>
            ) : (
              <>
                {!autoChunk && (
                  <button
                    onClick={handleSendStreamChunk}
                    className="flex-1 py-1.5 bg-amber-700 rounded hover:bg-amber-600"
                  >
                    Send Chunk
                  </button>
                )}
                <button
                  onClick={handleEndStream}
                  className="flex-1 py-1.5 border border-slate-600 rounded hover:bg-slate-800"
                >
                  End
                </button>
                <button
                  onClick={handleAbortStream}
                  className="py-1.5 px-2 bg-red-700 rounded hover:bg-red-600"
                >
                  Abort
                </button>
              </>
            )}
          </div>
          <div className="flex gap-3 text-[10px] text-slate-500">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={autoChunk}
                onChange={(e) => setAutoChunk(e.target.checked)}
                disabled={streamActive}
              />
              Auto-chunk
            </label>
            {autoChunk && (
              <label className="flex items-center gap-1">
                <input
                  type="number"
                  className="w-14 bg-slate-950 border border-slate-700 rounded px-1 text-center"
                  value={chunkInterval}
                  onChange={(e) => setChunkInterval(Number(e.target.value))}
                  disabled={streamActive}
                  min={100}
                  step={100}
                />
                ms
              </label>
            )}
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={includeThinking}
                onChange={(e) => setIncludeThinking(e.target.checked)}
                disabled={streamActive}
              />
              Thinking
            </label>
          </div>
        </div>
      </div>

      {/* Quick Buttons */}
      <div>
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">
          Other Actions
        </div>
        <div className="grid grid-cols-2 gap-1">
          {[
            {
              label: "Typing Start",
              fn: () =>
                msgChannel &&
                emit(WS_EVENTS.TYPING.START, { channelId: msgChannel }),
            },
            {
              label: "Typing Stop",
              fn: () =>
                msgChannel &&
                emit(WS_EVENTS.TYPING.STOP, { channelId: msgChannel }),
            },
            {
              label: "Mark Read",
              fn: () =>
                msgChannel &&
                emit(WS_EVENTS.READ_STATUS.MARK_AS_READ, {
                  channelId: msgChannel,
                }),
            },
            {
              label: "Join Channel",
              fn: () =>
                msgChannel &&
                emit(WS_EVENTS.CHANNEL.JOIN, { channelId: msgChannel }),
            },
            {
              label: "Leave Channel",
              fn: () =>
                msgChannel &&
                emit(WS_EVENTS.CHANNEL.LEAVE, { channelId: msgChannel }),
            },
          ].map(({ label, fn }) => (
            <button
              key={label}
              onClick={fn}
              disabled={disabled}
              className="py-1.5 text-[10px] border border-slate-700 rounded hover:bg-slate-800 disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
