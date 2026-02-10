import {
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  ORDERED_LIST,
  UNORDERED_LIST,
  CODE,
} from "@lexical/markdown";
import type { Transformer } from "@lexical/markdown";

// Chat-appropriate markdown transformers
// Excludes: HEADING, QUOTE (not useful for chat input)
export const CHAT_MARKDOWN_TRANSFORMERS: Transformer[] = [
  CODE,
  UNORDERED_LIST,
  ORDERED_LIST,
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  INLINE_CODE,
];
