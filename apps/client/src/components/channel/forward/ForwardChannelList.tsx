import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useChannels } from "@/hooks/useChannels";
import { Input } from "@/components/ui/input";

interface Props {
  excludeChannelId?: string;
  selectedChannelId: string | null;
  onSelect: (channelId: string) => void;
}

export function ForwardChannelList({
  excludeChannelId,
  selectedChannelId,
  onSelect,
}: Props) {
  const { t } = useTranslation("channel");
  const { data: channels = [] } = useChannels();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    return channels.filter((c) => {
      if (c.id === excludeChannelId) return false;
      if (c.isArchived) return false;
      if (c.isActivated === false) return false;
      if (!query) return true;
      return c.name.toLowerCase().includes(query.toLowerCase());
    });
  }, [channels, query, excludeChannelId]);

  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("forward.dialog.searchPlaceholder")}
        aria-label={t("forward.dialog.searchPlaceholder")}
      />
      <ul role="listbox" className="max-h-80 overflow-y-auto rounded border">
        {filtered.map((c) => (
          <li
            key={c.id}
            role="option"
            aria-selected={selectedChannelId === c.id}
            onClick={() => onSelect(c.id)}
            className={`cursor-pointer px-3 py-2 text-sm hover:bg-accent ${
              selectedChannelId === c.id ? "bg-accent" : ""
            }`}
          >
            #{c.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
