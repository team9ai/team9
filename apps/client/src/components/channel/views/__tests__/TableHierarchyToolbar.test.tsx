import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { TableHierarchyToolbar } from "../TableHierarchyToolbar";
import type { TableHierarchyToolbarProps } from "../TableHierarchyToolbar";

function renderToolbar(props: Partial<TableHierarchyToolbarProps> = {}) {
  const defaults: TableHierarchyToolbarProps = {
    config: {},
    onChange: vi.fn(),
    onExpandAll: vi.fn(),
    onCollapseAll: vi.fn(),
    ...props,
  };
  return { ...render(<TableHierarchyToolbar {...defaults} />), ...defaults };
}

describe("TableHierarchyToolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== Render state ====================

  it("renders the toggle with checked=true when hierarchyMode is true", () => {
    renderToolbar({ config: { hierarchyMode: true } });
    expect(screen.getByLabelText("层级视图")).toBeChecked();
  });

  it("renders the toggle with checked=false when hierarchyMode is false", () => {
    renderToolbar({ config: { hierarchyMode: false } });
    expect(screen.getByLabelText("层级视图")).not.toBeChecked();
  });

  it("renders the toggle with checked=false when hierarchyMode is absent", () => {
    renderToolbar({ config: {} });
    expect(screen.getByLabelText("层级视图")).not.toBeChecked();
  });

  // ==================== Toggle behaviour ====================

  it("toggle from unchecked fires onChange with hierarchyMode=true and groupBy=undefined", () => {
    const onChange = vi.fn();
    renderToolbar({ config: { hierarchyMode: false }, onChange });

    fireEvent.click(screen.getByLabelText("层级视图"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      hierarchyMode: true,
      groupBy: undefined,
    });
  });

  it("toggle from checked fires onChange with hierarchyMode=false and groupBy=undefined", () => {
    const onChange = vi.fn();
    renderToolbar({ config: { hierarchyMode: true }, onChange });

    fireEvent.click(screen.getByLabelText("层级视图"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      hierarchyMode: false,
      groupBy: undefined,
    });
  });

  // ==================== groupBy disables toggle ====================

  it("disables the toggle when groupBy is set", () => {
    renderToolbar({ config: { hierarchyMode: false, groupBy: "status" } });
    expect(screen.getByLabelText("层级视图")).toBeDisabled();
  });

  it("does not disable the toggle when groupBy is absent", () => {
    renderToolbar({ config: { hierarchyMode: false } });
    expect(screen.getByLabelText("层级视图")).not.toBeDisabled();
  });

  // ==================== Depth selector and expand/collapse ====================

  it("does not show depth selector or expand/collapse when hierarchyMode is false", () => {
    renderToolbar({ config: { hierarchyMode: false } });
    expect(screen.queryByLabelText("展开深度")).not.toBeInTheDocument();
    expect(screen.queryByText("展开全部")).not.toBeInTheDocument();
    expect(screen.queryByText("折叠全部")).not.toBeInTheDocument();
  });

  it("shows depth selector and expand/collapse buttons when hierarchy is active", () => {
    renderToolbar({ config: { hierarchyMode: true } });
    expect(screen.getByLabelText("展开深度")).toBeInTheDocument();
    expect(screen.getByText("展开全部")).toBeInTheDocument();
    expect(screen.getByText("折叠全部")).toBeInTheDocument();
  });

  it("depth selector defaults to 3 when hierarchyDefaultDepth is not set", () => {
    renderToolbar({ config: { hierarchyMode: true } });
    const select = screen.getByLabelText("展开深度") as HTMLSelectElement;
    expect(select.value).toBe("3");
  });

  it("depth selector shows the current hierarchyDefaultDepth value", () => {
    renderToolbar({
      config: { hierarchyMode: true, hierarchyDefaultDepth: 1 },
    });
    const select = screen.getByLabelText("展开深度") as HTMLSelectElement;
    expect(select.value).toBe("1");
  });

  it("depth selector has options 0 through 5", () => {
    renderToolbar({ config: { hierarchyMode: true } });
    const select = screen.getByLabelText("展开深度") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => Number(o.value));
    expect(options).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("changing depth selector fires onChange with new hierarchyDefaultDepth", () => {
    const onChange = vi.fn();
    renderToolbar({ config: { hierarchyMode: true }, onChange });

    const select = screen.getByLabelText("展开深度");
    fireEvent.change(select, { target: { value: "2" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ hierarchyDefaultDepth: 2 });
  });

  it("changing depth to 0 fires onChange with hierarchyDefaultDepth=0", () => {
    const onChange = vi.fn();
    renderToolbar({
      config: { hierarchyMode: true, hierarchyDefaultDepth: 3 },
      onChange,
    });

    const select = screen.getByLabelText("展开深度");
    fireEvent.change(select, { target: { value: "0" } });

    expect(onChange).toHaveBeenCalledWith({ hierarchyDefaultDepth: 0 });
  });

  // ==================== Expand/Collapse callbacks ====================

  it("clicking 展开全部 fires onExpandAll callback", () => {
    const onExpandAll = vi.fn();
    renderToolbar({ config: { hierarchyMode: true }, onExpandAll });

    fireEvent.click(screen.getByText("展开全部"));

    expect(onExpandAll).toHaveBeenCalledTimes(1);
  });

  it("clicking 折叠全部 fires onCollapseAll callback", () => {
    const onCollapseAll = vi.fn();
    renderToolbar({ config: { hierarchyMode: true }, onCollapseAll });

    fireEvent.click(screen.getByText("折叠全部"));

    expect(onCollapseAll).toHaveBeenCalledTimes(1);
  });

  it("does not throw when onExpandAll is undefined and button is clicked", () => {
    renderToolbar({
      config: { hierarchyMode: true },
      onExpandAll: undefined,
    });

    // Click should not throw
    expect(() => fireEvent.click(screen.getByText("展开全部"))).not.toThrow();
  });

  it("does not throw when onCollapseAll is undefined and button is clicked", () => {
    renderToolbar({
      config: { hierarchyMode: true },
      onCollapseAll: undefined,
    });

    expect(() => fireEvent.click(screen.getByText("折叠全部"))).not.toThrow();
  });
});
