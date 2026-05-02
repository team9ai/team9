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
});
