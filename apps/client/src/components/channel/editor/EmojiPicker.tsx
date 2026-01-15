import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { useTheme } from "@/stores/useAppStore";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

interface EmojiData {
  native: string;
  id: string;
  name: string;
  unified: string;
}

export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const theme = useTheme();

  return (
    <Picker
      data={data}
      onEmojiSelect={(emoji: EmojiData) => onSelect(emoji.native)}
      theme={theme}
      previewPosition="none"
      skinTonePosition="none"
      maxFrequentRows={2}
      perLine={8}
      emojiSize={22}
      emojiButtonSize={32}
    />
  );
}
