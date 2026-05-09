import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentAccessControl } from "../AgentAccessControl";

describe("AgentAccessControl", () => {
  it("renders a compact button with the current access level", () => {
    render(<AgentAccessControl value="read" onChange={() => {}} />);
    expect(
      screen.getByRole("button", {
        name: /^access: read$/i,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /hidden/i })).toBeNull();
    expect(screen.queryByRole("radio", { name: /read-only/i })).toBeNull();
    expect(screen.queryByRole("radio", { name: /read & write/i })).toBeNull();
  });

  it("opens the access dialog from the compact button", () => {
    render(<AgentAccessControl value="read" onChange={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /^access: read$/i,
      }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /agent permissions/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /hidden/i })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /read-only/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /read & write/i }),
    ).toBeInTheDocument();
  });

  it("marks the current value as checked", () => {
    render(<AgentAccessControl value="write" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^access: write$/i }));
    const writeRadio = screen.getByRole("radio", { name: /read & write/i });
    expect(writeRadio).toBeChecked();
    expect(screen.getByRole("radio", { name: /hidden/i })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /read-only/i })).not.toBeChecked();
  });

  it("fires onChange with 'none' when Hidden is clicked", () => {
    const onChange = vi.fn();
    render(<AgentAccessControl value="read" onChange={onChange} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /^access: read$/i,
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /hidden/i }));
    expect(onChange).toHaveBeenCalledWith("none");
  });

  it("fires onChange with 'read' when Read-only is clicked", () => {
    const onChange = vi.fn();
    render(<AgentAccessControl value="none" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^access: hidden$/i }));
    fireEvent.click(screen.getByRole("radio", { name: /read-only/i }));
    expect(onChange).toHaveBeenCalledWith("read");
  });

  it("fires onChange with 'write' when Read & write is clicked", () => {
    const onChange = vi.fn();
    render(<AgentAccessControl value="read" onChange={onChange} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /^access: read$/i,
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /read & write/i }));
    expect(onChange).toHaveBeenCalledWith("write");
  });

  it("disables the compact button when disabled prop is true", () => {
    render(<AgentAccessControl value="read" onChange={() => {}} disabled />);
    expect(
      screen.getByRole("button", {
        name: /^access: read$/i,
      }),
    ).toBeDisabled();
  });

  it("renders help text for each option inside the dialog", () => {
    render(<AgentAccessControl value="read" onChange={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: /^access: read$/i,
      }),
    );
    expect(
      screen.getByText(/agents in this workspace cannot see or use/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/agents can find and use this skill but cannot edit/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/agents can both use and edit this skill/i),
    ).toBeInTheDocument();
  });
});
