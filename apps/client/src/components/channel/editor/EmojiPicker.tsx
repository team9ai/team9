import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";

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
  return (
    <Picker
      data={data}
      onEmojiSelect={(emoji: EmojiData) => onSelect(emoji.native)}
      theme="light"
      previewPosition="none"
      skinTonePosition="none"
      maxFrequentRows={2}
      perLine={8}
      emojiSize={22}
      emojiButtonSize={32}
    />
  );
}
