import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ScopeEditor } from "../ScopeEditor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("<ScopeEditor>", () => {
  it("renders channelIds input for messages:send", () => {
    render(
      <ScopeEditor
        permissionKey="messages:send"
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/channel ids/i)).toBeInTheDocument();
  });

  it("emits onChange with parsed array on change", () => {
    const onChange = vi.fn();
    render(
      <ScopeEditor
        permissionKey="messages:send"
        value={{}}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText(/channel ids/i);
    fireEvent.change(input, { target: { value: "c1, c2" } });
    expect(onChange).toHaveBeenLastCalledWith({ channelIds: ["c1", "c2"] });
  });

  it("falls back to JSON textarea for unknown keys", () => {
    render(
      <ScopeEditor
        permissionKey="unknown:key"
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("textbox", { name: /json/i })).toBeInTheDocument();
  });

  // ── tools:invoke ─────────────────────────────────────────────────────────

  it("renders toolNames + targets array inputs for tools:invoke", () => {
    render(
      <ScopeEditor
        permissionKey="tools:invoke"
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText(/tool names/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/targets/i)).toBeInTheDocument();
  });

  it("emits onChange with toolNames array when toolNames input changes", () => {
    const onChange = vi.fn();
    render(
      <ScopeEditor
        permissionKey="tools:invoke"
        value={{}}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText(/tool names/i);
    fireEvent.change(input, { target: { value: "sql, shell" } });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ toolNames: ["sql", "shell"] }),
    );
  });

  // ── wiki:read ────────────────────────────────────────────────────────────

  it("renders wikiId string input (not array) for wiki:read", () => {
    render(
      <ScopeEditor permissionKey="wiki:read" value={{}} onChange={() => {}} />,
    );
    const input = screen.getByLabelText(/wiki id/i);
    expect(input).toBeInTheDocument();
    // It should be a single text input, not comma-separated array input
    expect(input).not.toHaveAttribute("placeholder", "comma-separated");
  });

  it("emits onChange with wikiId string for wiki:read", () => {
    const onChange = vi.fn();
    render(
      <ScopeEditor permissionKey="wiki:read" value={{}} onChange={onChange} />,
    );
    const input = screen.getByLabelText(/wiki id/i);
    fireEvent.change(input, { target: { value: "wiki-123" } });
    expect(onChange).toHaveBeenLastCalledWith({ wikiId: "wiki-123" });
  });

  // ── files:read ───────────────────────────────────────────────────────────

  it("renders paths array input for files:read", () => {
    render(
      <ScopeEditor permissionKey="files:read" value={{}} onChange={() => {}} />,
    );
    const input = screen.getByLabelText(/paths/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("placeholder", "comma-separated");
  });

  it("emits onChange with parsed paths array for files:read", () => {
    const onChange = vi.fn();
    render(
      <ScopeEditor permissionKey="files:read" value={{}} onChange={onChange} />,
    );
    const input = screen.getByLabelText(/paths/i);
    fireEvent.change(input, { target: { value: "/a, /b" } });
    expect(onChange).toHaveBeenLastCalledWith({ paths: ["/a", "/b"] });
  });

  // ── JSON textarea fallback: invalid JSON does not crash ──────────────────

  it("JSON textarea fallback ignores invalid JSON without crashing", () => {
    const onChange = vi.fn();
    render(
      <ScopeEditor
        permissionKey="unknown:key"
        value={{}}
        onChange={onChange}
      />,
    );
    const textarea = screen.getByRole("textbox", { name: /json/i });
    // Type invalid JSON — component should not throw
    expect(() => {
      fireEvent.change(textarea, { target: { value: "{ invalid json {{" } });
    }).not.toThrow();
    // onChange should NOT have been called since the JSON is invalid
    expect(onChange).not.toHaveBeenCalled();
  });
});
