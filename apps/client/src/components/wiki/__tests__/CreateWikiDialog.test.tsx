import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---------------------------------------------------------------
//
// Swap the heavyweight leaves / side-effect-y hooks so the test exercises
// just this dialog's own logic:
//  - `useCreateWiki` → a jest-controlled mutation spy.
//  - `useNavigate` → a spy we can assert against for the post-submit route.
//  - `IconPickerPopover` → a dumb button that forwards a fixed emoji. Keeps
//    the test off the real EmojiPicker (and its font data) in jsdom.

const mockMutateAsync = vi.hoisted(() =>
  vi.fn<
    (input: { name: string; slug?: string }) => Promise<{
      id: string;
      slug: string;
    }>
  >(),
);
const mockIsPending = vi.hoisted(() => ({ value: false }));
const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useWikis", () => ({
  useCreateWiki: () => ({
    mutateAsync: mockMutateAsync,
    get isPending() {
      return mockIsPending.value;
    },
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../IconPickerPopover", () => ({
  IconPickerPopover: (props: {
    value?: string;
    onChange: (icon: string) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="mock-icon-picker"
      data-value={props.value ?? ""}
      data-disabled={props.disabled ? "true" : "false"}
      disabled={props.disabled}
      onClick={() => props.onChange("📚")}
    >
      icon-picker
    </button>
  ),
}));

import { CreateWikiDialog, slugifyWikiName } from "../CreateWikiDialog";

beforeEach(() => {
  mockMutateAsync.mockReset();
  mockNavigate.mockReset();
  mockIsPending.value = false;
  document.body.innerHTML = "";
  // Silence the alert-based toast surface during tests.
  vi.spyOn(window, "alert").mockImplementation(() => {});
});

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof CreateWikiDialog>> = {},
) {
  const onOpenChange = vi.fn();
  const props = { open: true, onOpenChange, ...overrides };
  const utils = render(<CreateWikiDialog {...props} />);
  return { ...utils, onOpenChange };
}

describe("slugifyWikiName", () => {
  it("lowercases, collapses non-alphanumerics, and trims dashes", () => {
    expect(slugifyWikiName("Team Handbook!")).toBe("team-handbook");
    expect(slugifyWikiName("  Hello   World  ")).toBe("hello-world");
    expect(slugifyWikiName("Design @2026 docs")).toBe("design-2026-docs");
  });

  it("empty / whitespace-only input returns empty string", () => {
    expect(slugifyWikiName("")).toBe("");
    expect(slugifyWikiName("   ")).toBe("");
    expect(slugifyWikiName("!!!")).toBe("");
  });

  it("truncates very long names to 50 chars", () => {
    const long = "a".repeat(80);
    expect(slugifyWikiName(long)).toHaveLength(50);
  });
});

describe("CreateWikiDialog", () => {
  it("renders nothing when closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByTestId("create-wiki-dialog")).toBeNull();
  });

  it("renders name, slug, icon, and action buttons when open", () => {
    renderDialog();
    expect(screen.getByTestId("create-wiki-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("create-wiki-name-input")).toBeInTheDocument();
    expect(screen.getByTestId("create-wiki-slug-input")).toBeInTheDocument();
    expect(screen.getByTestId("mock-icon-picker")).toBeInTheDocument();
    expect(screen.getByTestId("create-wiki-submit")).toBeInTheDocument();
    expect(screen.getByTestId("create-wiki-cancel")).toBeInTheDocument();
  });

  it("auto-derives the slug from the name while slug is untouched", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Team Handbook" },
    });
    expect(
      (screen.getByTestId("create-wiki-slug-input") as HTMLInputElement).value,
    ).toBe("team-handbook");
  });

  it("stops auto-deriving once the user edits the slug manually", () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Team" },
    });
    fireEvent.change(screen.getByTestId("create-wiki-slug-input"), {
      target: { value: "custom-slug" },
    });
    // Now the name changes again — slug should not move.
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Team Handbook" },
    });
    expect(
      (screen.getByTestId("create-wiki-slug-input") as HTMLInputElement).value,
    ).toBe("custom-slug");
  });

  it("shows a validation error when submitted with an empty name", async () => {
    renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    expect(
      screen.getByTestId("create-wiki-validation-error"),
    ).toHaveTextContent(/name is required/i);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("shows a validation error when submitted with a whitespace-only name", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "   " },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    expect(
      screen.getByTestId("create-wiki-validation-error"),
    ).toHaveTextContent(/name is required/i);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("shows a validation error when slug does not match the pattern", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Valid Name" },
    });
    fireEvent.change(screen.getByTestId("create-wiki-slug-input"), {
      target: { value: "Bad Slug!" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    expect(
      screen.getByTestId("create-wiki-validation-error"),
    ).toHaveTextContent(/lowercase letters, numbers, and dashes/i);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("submits to useCreateWiki, closes on success, and navigates to the new wiki", async () => {
    mockMutateAsync.mockResolvedValueOnce({
      id: "wiki-1",
      slug: "team-handbook",
    });
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Team Handbook" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });

    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
    expect(mockMutateAsync).toHaveBeenCalledWith({
      name: "Team Handbook",
      slug: "team-handbook",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/wiki/$wikiSlug",
      params: { wikiSlug: "team-handbook" },
    });
  });

  it("omits the slug from the payload when left empty so the server can default", async () => {
    mockMutateAsync.mockResolvedValueOnce({ id: "wiki-2", slug: "derived" });
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Derived" },
    });
    // Clear the auto-derived slug the user never touched.
    fireEvent.change(screen.getByTestId("create-wiki-slug-input"), {
      target: { value: "" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    expect(mockMutateAsync).toHaveBeenCalledWith({
      name: "Derived",
      slug: undefined,
    });
  });

  it("surfaces a 409 error inline when the slug is already taken", async () => {
    const err = Object.assign(new Error("slug taken"), {
      status: 409,
      response: { status: 409, data: { message: "slug taken" } },
    });
    mockMutateAsync.mockRejectedValueOnce(err);
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Dup" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    expect(screen.getByTestId("create-wiki-server-error")).toHaveTextContent(
      /already exists/i,
    );
    expect(window.alert).toHaveBeenCalledWith(
      expect.stringMatching(/already exists/i),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("falls back to the generic 'Create failed' message for non-409 errors without body", async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error(""));
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Dup" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    expect(screen.getByTestId("create-wiki-server-error")).toHaveTextContent(
      /create failed\. please try again/i,
    );
  });

  it("uses the server-provided message for non-409 errors that carry one", async () => {
    const err = Object.assign(new Error("boom"), {
      status: 500,
      response: { status: 500, data: { message: "boom" } },
    });
    mockMutateAsync.mockRejectedValueOnce(err);
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Dup" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    expect(screen.getByTestId("create-wiki-server-error")).toHaveTextContent(
      /create failed: boom/i,
    );
  });

  it("Cancel closes the dialog without firing the mutation", () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByTestId("create-wiki-cancel"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("disables inputs and swaps the submit label while the mutation is in-flight", () => {
    mockIsPending.value = true;
    renderDialog();
    expect(screen.getByTestId("create-wiki-submit")).toBeDisabled();
    expect(screen.getByTestId("create-wiki-submit")).toHaveTextContent(
      /creating…/i,
    );
    expect(screen.getByTestId("create-wiki-cancel")).toBeDisabled();
    expect(screen.getByTestId("create-wiki-name-input")).toBeDisabled();
    expect(screen.getByTestId("create-wiki-slug-input")).toBeDisabled();
    expect(screen.getByTestId("mock-icon-picker")).toBeDisabled();
  });

  it("blocks a second submit while the first is in flight", async () => {
    mockIsPending.value = true;
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Team" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    // Button is disabled, but guard against a racing form submit too.
    const form = screen.getByTestId("create-wiki-name-input").closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("accepts a fresh icon selection from the picker", () => {
    renderDialog();
    const picker = screen.getByTestId("mock-icon-picker");
    expect(picker).toHaveAttribute("data-value", "");
    fireEvent.click(picker);
    // Re-query after the state update — value prop should now reflect the
    // picker's fixed emoji.
    expect(screen.getByTestId("mock-icon-picker")).toHaveAttribute(
      "data-value",
      "📚",
    );
  });

  it("resets all fields and errors when the dialog is re-opened", async () => {
    const { rerender, onOpenChange } = renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Stale" },
    });
    fireEvent.change(screen.getByTestId("create-wiki-slug-input"), {
      target: { value: "stale-slug" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    // Validation state set, now close + reopen.
    rerender(<CreateWikiDialog open={false} onOpenChange={onOpenChange} />);
    act(() => {
      rerender(<CreateWikiDialog open onOpenChange={onOpenChange} />);
    });
    expect(
      (screen.getByTestId("create-wiki-name-input") as HTMLInputElement).value,
    ).toBe("");
    expect(
      (screen.getByTestId("create-wiki-slug-input") as HTMLInputElement).value,
    ).toBe("");
    expect(screen.queryByTestId("create-wiki-validation-error")).toBeNull();
    expect(screen.queryByTestId("create-wiki-server-error")).toBeNull();
  });

  it("clears inline errors once the user edits after a failure", async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error(""));
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "X" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    expect(screen.getByTestId("create-wiki-server-error")).toBeInTheDocument();
    // Another keystroke should wipe the banner.
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Xy" },
    });
    expect(screen.queryByTestId("create-wiki-server-error")).toBeNull();
  });

  it("clears inline errors once the user edits the slug after a failure", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Valid" },
    });
    fireEvent.change(screen.getByTestId("create-wiki-slug-input"), {
      target: { value: "Bad!" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    expect(
      screen.getByTestId("create-wiki-validation-error"),
    ).toBeInTheDocument();
    // Edit the slug again.
    fireEvent.change(screen.getByTestId("create-wiki-slug-input"), {
      target: { value: "good" },
    });
    expect(screen.queryByTestId("create-wiki-validation-error")).toBeNull();
  });

  it("clears a validationError via the name handler too", async () => {
    renderDialog();
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    expect(
      screen.getByTestId("create-wiki-validation-error"),
    ).toBeInTheDocument();
    // Next keystroke in the name input wipes the banner.
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Hello" },
    });
    expect(screen.queryByTestId("create-wiki-validation-error")).toBeNull();
  });

  it("clears a serverError via the slug handler too", async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error(""));
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Team" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("create-wiki-submit"));
    });
    expect(screen.getByTestId("create-wiki-server-error")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("create-wiki-slug-input"), {
      target: { value: "team-handbook" },
    });
    expect(screen.queryByTestId("create-wiki-server-error")).toBeNull();
  });

  it("submits via Enter in the form (native submit)", async () => {
    mockMutateAsync.mockResolvedValueOnce({
      id: "wiki-3",
      slug: "enter-submit",
    });
    renderDialog();
    fireEvent.change(screen.getByTestId("create-wiki-name-input"), {
      target: { value: "Enter Submit" },
    });
    const form = screen.getByTestId("create-wiki-name-input").closest("form")!;
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(mockMutateAsync).toHaveBeenCalledTimes(1);
  });
});
