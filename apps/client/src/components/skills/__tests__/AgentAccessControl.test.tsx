import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentAccessControl } from "../AgentAccessControl";

describe("AgentAccessControl", () => {
  it("renders all three options", () => {
    render(<AgentAccessControl value="read" onChange={() => {}} />);
    expect(screen.getByText(/hidden/i)).toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByText(/read & write/i)).toBeInTheDocument();
  });

  it("renders the legend label", () => {
    render(<AgentAccessControl value="read" onChange={() => {}} />);
    expect(screen.getByText(/agent access/i)).toBeInTheDocument();
  });

  it("marks the current value as checked", () => {
    render(<AgentAccessControl value="write" onChange={() => {}} />);
    const writeRadio = screen.getByRole("radio", { name: /read & write/i });
    expect(writeRadio).toBeChecked();
    expect(screen.getByRole("radio", { name: /hidden/i })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /read-only/i })).not.toBeChecked();
  });

  it("fires onChange with 'none' when Hidden is clicked", () => {
    const onChange = vi.fn();
    render(<AgentAccessControl value="read" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /hidden/i }));
    expect(onChange).toHaveBeenCalledWith("none");
  });

  it("fires onChange with 'read' when Read-only is clicked", () => {
    const onChange = vi.fn();
    render(<AgentAccessControl value="none" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /read-only/i }));
    expect(onChange).toHaveBeenCalledWith("read");
  });

  it("fires onChange with 'write' when Read & write is clicked", () => {
    const onChange = vi.fn();
    render(<AgentAccessControl value="read" onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /read & write/i }));
    expect(onChange).toHaveBeenCalledWith("write");
  });

  it("disables all radio inputs when disabled prop is true", () => {
    render(<AgentAccessControl value="read" onChange={() => {}} disabled />);
    const radios = screen.getAllByRole("radio");
    for (const radio of radios) {
      expect(radio).toBeDisabled();
    }
  });

  it("renders help text for each option", () => {
    render(<AgentAccessControl value="read" onChange={() => {}} />);
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
