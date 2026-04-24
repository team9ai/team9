import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

// Tracks IME composition state via compositionstart/compositionend on the
// editor's root element, exposing a ref that command handlers can read
// synchronously at dispatch time.
//
// Why a ref + delayed clear instead of relying on event.isComposing:
// WebKit bug #165004 — on macOS WKWebView (Tauri desktop), the event
// sequence when pressing Enter to commit an IME composition is
// `compositionend -> keydown -> keyup`, the opposite of Chromium's
// `keydown(isComposing:true) -> compositionend`. By the time the Enter
// keydown reaches Lexical's KEY_ENTER_COMMAND listeners, the editor's
// internal `isComposing()` has already been cleared by compositionend,
// and that keydown's `event.isComposing` is incorrectly `false` (Safari
// violates the W3C spec here). Deferring the ref's clear by one animation
// frame keeps the flag set across that same-tick keydown, giving command
// handlers a reliable way to detect "this Enter is committing IME, not
// sending the message".

type IsComposingRef = MutableRefObject<boolean>;

const CompositionStateContext = createContext<IsComposingRef | null>(null);

export function useIsComposingRef(): IsComposingRef {
  const ref = useContext(CompositionStateContext);
  if (!ref) {
    throw new Error(
      "useIsComposingRef must be used inside <CompositionStateProvider>",
    );
  }
  return ref;
}

export function CompositionStateProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [editor] = useLexicalComposerContext();
  const isComposingRef = useRef(false);

  useEffect(() => {
    let pendingFrame: number | null = null;

    const onCompositionStart = () => {
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      }
      isComposingRef.current = true;
    };

    const onCompositionEnd = () => {
      // Defer the clear so a WKWebView-style post-compositionend keydown
      // still sees `isComposingRef.current === true`.
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
      }
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        isComposingRef.current = false;
      });
    };

    const unregister = editor.registerRootListener((rootElement, prev) => {
      if (prev) {
        prev.removeEventListener("compositionstart", onCompositionStart);
        prev.removeEventListener("compositionend", onCompositionEnd);
      }
      if (rootElement) {
        rootElement.addEventListener("compositionstart", onCompositionStart);
        rootElement.addEventListener("compositionend", onCompositionEnd);
      }
    });

    return () => {
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
        pendingFrame = null;
      }
      isComposingRef.current = false;
      unregister();
    };
  }, [editor]);

  return (
    <CompositionStateContext.Provider value={isComposingRef}>
      {children}
    </CompositionStateContext.Provider>
  );
}

// Returns true when the current KeyboardEvent should be treated as part
// of an IME composition and therefore not be interpreted as a plain Enter
// (or other command key).
export function isImeCompositionEvent(
  event: KeyboardEvent | null,
  isComposingRef: IsComposingRef,
): boolean {
  if (isComposingRef.current) return true;
  if (event?.isComposing) return true;
  // Legacy signal used by older WebKit / Chromium during IME composition.
  if (event?.keyCode === 229) return true;
  return false;
}
