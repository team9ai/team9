import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SelectOptionsEditor } from "../PropertySchemaManager";
import type { SelectOption } from "@/types/properties";

function setup(initial: SelectOption[] = []) {
  const onChange = vi.fn();
  const utils = render(
    <SelectOptionsEditor options={initial} onChange={onChange} />,
  );
  return { ...utils, onChange };
}

describe("SelectOptionsEditor", () => {
  it("adds a new option with an auto-assigned color on Enter", () => {
    const { onChange } = setup();
    const input = screen.getByPlaceholderText("New option...");

    fireEvent.change(input, { target: { value: "Todo" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as SelectOption[];
    expect(next).toHaveLength(1);
    expect(next[0].value).toBe("Todo");
    expect(next[0].label).toBe("Todo");
    // Auto-assigned color must be one of the named presets, not undefined.
    expect(next[0].color).toBeTruthy();
    expect(next[0].color).not.toBe("default");
  });

  it("assigns a distinct color to each new option (cycle)", () => {
    const { rerender, onChange } = setup();
    const input = screen.getByPlaceholderText("New option...");

    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const first = onChange.mock.calls[0][0] as SelectOption[];

    rerender(<SelectOptionsEditor options={first} onChange={onChange} />);
    const input2 = screen.getByPlaceholderText("New option...");
    fireEvent.change(input2, { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    const second = onChange.mock.calls[1][0] as SelectOption[];
    expect(second).toHaveLength(2);
    expect(second[1].color).not.toBe(first[0].color);
  });

  it("does not add a duplicate value", () => {
    const { onChange } = setup([{ value: "Todo", label: "Todo" }]);
    const input = screen.getByPlaceholderText("New option...");
    fireEvent.change(input, { target: { value: "Todo" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes an option via its X button", () => {
    const { onChange } = setup([
      { value: "Todo", label: "Todo", color: "red" },
      { value: "Done", label: "Done", color: "green" },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Todo" }));
    expect(onChange).toHaveBeenCalledWith([
      { value: "Done", label: "Done", color: "green" },
    ]);
  });

  it("opens the color picker and changes an option color", () => {
    const { onChange } = setup([
      { value: "Todo", label: "Todo", color: "red" },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Change option color" }),
    );

    // Radix Popover portals into document.body — query from there.
    const blueSwatch = within(document.body).getByRole("button", {
      name: "Blue",
    });
    fireEvent.click(blueSwatch);

    expect(onChange).toHaveBeenCalledWith([
      { value: "Todo", label: "Todo", color: "blue" },
    ]);
  });

  it("selecting 'Default' clears the color", () => {
    const { onChange } = setup([
      { value: "Todo", label: "Todo", color: "red" },
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Change option color" }),
    );
    const defaultSwatch = within(document.body).getByRole("button", {
      name: "Default",
    });
    fireEvent.click(defaultSwatch);

    expect(onChange).toHaveBeenCalledWith([
      { value: "Todo", label: "Todo", color: undefined },
    ]);
  });
});
