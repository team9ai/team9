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
  QUOTE,
  HEADING,
} from "@lexical/markdown";
import type { Transformer } from "@lexical/markdown";

// Document-appropriate markdown transformers
// Includes HEADING (unlike chat transformers)
export const DOCUMENT_MARKDOWN_TRANSFORMERS: Transformer[] = [
  HEADING,
  CODE,
  QUOTE,
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
