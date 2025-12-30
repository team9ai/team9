import { Hash, Lock, Phone, Video, Search, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Channel } from "@/types/im";

interface ChannelHeaderProps {
  channel: Channel;
}

export function ChannelHeader({ channel }: ChannelHeaderProps) {
  const ChannelIcon = channel.type === "private" ? Lock : Hash;

  return (
    <>
      <div className="h-14 px-4 flex items-center justify-between border-b">
        <div className="flex items-center gap-2">
          <ChannelIcon size={20} className="text-muted-foreground" />
          <h2 className="font-semibold">{channel.name}</h2>
          {channel.description && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <p className="text-sm text-muted-foreground">
                {channel.description}
              </p>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon">
            <Phone size={18} />
          </Button>
          <Button variant="ghost" size="icon">
            <Video size={18} />
          </Button>
          <Button variant="ghost" size="icon">
            <Search size={18} />
          </Button>
          <Button variant="ghost" size="icon">
            <Info size={18} />
          </Button>
        </div>
      </div>
    </>
  );
}
