import { describe, expect, it, vi } from "vitest";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from "lexical";
import { exportToHtml, hasContent } from "../exportContent";
import { submitEditorContent } from "../submitEditorContent";

function createTextEditor(text: string) {
  const editor = createEditor({
    namespace: "submit-editor-content-test",
    onError: (error) => {
      throw error;
    },
    nodes: [],
  });

  editor.update(
    () => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(text));
      root.append(paragraph);
    },
    { discrete: true },
  );

  return editor;
}

describe("submitEditorContent", () => {
  it("emits plaintext content + Lexical serialized AST, then clears the editor", async () => {
    const editor = createTextEditor("Hello world");
    const onSubmit = vi.fn(async () => undefined);

    const didSubmit = await submitEditorContent({
      editor,
      onSubmit,
    });

    expect(didSubmit).toBe(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const call = (onSubmit.mock.calls as unknown as unknown[][])[0]!;
    const payload = call[0] as {
      content: string;
      contentAst?: Record<string, unknown>;
    };
    expect(payload.content).toBe("Hello world");
    // contentAst is the canonical Lexical EditorState; new clients render it
    // directly without going through dangerouslySetInnerHTML.
    expect(payload.contentAst).toBeDefined();
    expect((payload.contentAst as { root: unknown }).root).toBeDefined();
    expect(hasContent(editor)).toBe(false);
    expect(exportToHtml(editor)).toBe("<br>");
  });

  it("restores the editor content when submit fails", async () => {
    const editor = createTextEditor("Retry me");
    const onSubmit = vi.fn(async () => {
      throw new Error("submit failed");
    });

    await expect(
      submitEditorContent({
        editor,
        onSubmit,
      }),
    ).rejects.toThrow("submit failed");

    expect(hasContent(editor)).toBe(true);
    expect(exportToHtml(editor)).toBe("<p>Retry me</p>");
  });
});
