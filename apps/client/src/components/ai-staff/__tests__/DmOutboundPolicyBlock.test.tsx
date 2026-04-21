import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DmOutboundPolicyBlock } from "../DmOutboundPolicyBlock";
import type { DmOutboundPolicy } from "@/types/bot-dm-policy";
import type { UserOption } from "../MultiUserPicker";

// Mock MultiUserPicker so tests focus on DmOutboundPolicyBlock behaviour
vi.mock("../MultiUserPicker", () => ({
  MultiUserPicker: ({
    value,
    onChange,
    disabled,
  }: {
    value: UserOption[];
    onChange: (next: UserOption[]) => void;
    disabled?: boolean;
  }) => (
    <div
      data-testid="multi-user-picker"
      data-disabled={disabled ? "true" : "false"}
      data-count={value.length}
      onClick={() =>
        onChange([...value, { userId: "u1", displayName: "Test User" }])
      }
    />
  ),
}));

function renderBlock(
  overrides: Partial<Parameters<typeof DmOutboundPolicyBlock>[0]> = {},
) {
  const defaultValue: DmOutboundPolicy = { mode: "owner-only" };
  const onChange = vi.fn();
  const result = render(
    <DmOutboundPolicyBlock
      value={defaultValue}
      onChange={onChange}
      {...overrides}
    />,
  );
  return { ...result, onChange };
}

describe("DmOutboundPolicyBlock", () => {
  describe("renders all 4 modes by default", () => {
    it("shows owner-only option", () => {
      renderBlock();
      expect(screen.getByLabelText(/owner only/i)).toBeInTheDocument();
    });

    it("shows same-tenant option", () => {
      renderBlock();
      expect(screen.getByLabelText(/same workspace/i)).toBeInTheDocument();
    });

    it("shows whitelist option", () => {
      renderBlock();
      expect(screen.getByLabelText(/whitelist/i)).toBeInTheDocument();
    });

    it("shows anyone option", () => {
      renderBlock();
      expect(screen.getByLabelText(/anyone/i)).toBeInTheDocument();
    });

    it("renders 4 radio inputs", () => {
      renderBlock();
      const radios = screen.getAllByRole("radio");
      expect(radios).toHaveLength(4);
    });
  });

  describe("hideOwnerOnly prop", () => {
    it("hides the owner-only option when hideOwnerOnly=true", () => {
      renderBlock({ hideOwnerOnly: true });
      expect(screen.queryByLabelText(/owner only/i)).not.toBeInTheDocument();
    });

    it("shows only 3 radio options when hideOwnerOnly=true", () => {
      renderBlock({ hideOwnerOnly: true });
      const radios = screen.getAllByRole("radio");
      expect(radios).toHaveLength(3);
    });

    it("still shows same-tenant, whitelist, anyone when hideOwnerOnly=true", () => {
      renderBlock({ hideOwnerOnly: true });
      expect(screen.getByLabelText(/same workspace/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/whitelist/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/anyone/i)).toBeInTheDocument();
    });
  });

  describe("whitelist mode", () => {
    it("does not show MultiUserPicker when mode is owner-only", () => {
      renderBlock({ value: { mode: "owner-only" } });
      expect(screen.queryByTestId("multi-user-picker")).not.toBeInTheDocument();
    });

    it("does not show MultiUserPicker when mode is same-tenant", () => {
      renderBlock({ value: { mode: "same-tenant" } });
      expect(screen.queryByTestId("multi-user-picker")).not.toBeInTheDocument();
    });

    it("does not show MultiUserPicker when mode is anyone", () => {
      renderBlock({ value: { mode: "anyone" } });
      expect(screen.queryByTestId("multi-user-picker")).not.toBeInTheDocument();
    });

    it("shows MultiUserPicker when mode is whitelist", () => {
      renderBlock({ value: { mode: "whitelist" } });
      expect(screen.getByTestId("multi-user-picker")).toBeInTheDocument();
    });

    it("passes whitelistUsers to MultiUserPicker", () => {
      const users: UserOption[] = [{ userId: "u1", displayName: "Alice" }];
      renderBlock({ value: { mode: "whitelist" }, whitelistUsers: users });
      const picker = screen.getByTestId("multi-user-picker");
      expect(picker.dataset.count).toBe("1");
    });

    it("calls onWhitelistUsersChange when MultiUserPicker onChange fires", () => {
      const onWhitelistUsersChange = vi.fn();
      renderBlock({
        value: { mode: "whitelist" },
        whitelistUsers: [],
        onWhitelistUsersChange,
      });
      fireEvent.click(screen.getByTestId("multi-user-picker"));
      expect(onWhitelistUsersChange).toHaveBeenCalledWith([
        { userId: "u1", displayName: "Test User" },
      ]);
    });

    it("calls onChange with derived userIds when MultiUserPicker onChange fires", () => {
      const onChange = vi.fn();
      const onWhitelistUsersChange = vi.fn();
      render(
        <DmOutboundPolicyBlock
          value={{ mode: "whitelist" }}
          onChange={onChange}
          whitelistUsers={[]}
          onWhitelistUsersChange={onWhitelistUsersChange}
        />,
      );
      fireEvent.click(screen.getByTestId("multi-user-picker"));
      expect(onChange).toHaveBeenCalledWith({
        mode: "whitelist",
        userIds: ["u1"],
      });
    });

    it("calls onChange with derived userIds even without onWhitelistUsersChange", () => {
      const onChange = vi.fn();
      render(
        <DmOutboundPolicyBlock
          value={{ mode: "whitelist" }}
          onChange={onChange}
          whitelistUsers={[]}
        />,
      );
      fireEvent.click(screen.getByTestId("multi-user-picker"));
      expect(onChange).toHaveBeenCalledWith({
        mode: "whitelist",
        userIds: ["u1"],
      });
    });

    it("clears whitelist when switching away from whitelist mode", () => {
      const onWhitelistUsersChange = vi.fn();
      const onChange = vi.fn();
      render(
        <DmOutboundPolicyBlock
          value={{ mode: "whitelist" }}
          onChange={onChange}
          whitelistUsers={[{ userId: "u1", displayName: "Alice" }]}
          onWhitelistUsersChange={onWhitelistUsersChange}
        />,
      );
      // Click the "Anyone" radio
      fireEvent.click(screen.getByLabelText(/anyone/i));
      expect(onWhitelistUsersChange).toHaveBeenCalledWith([]);
      expect(onChange).toHaveBeenCalledWith({ mode: "anyone" });
    });
  });

  describe("disabled prop", () => {
    it("disables all radio inputs when disabled=true", () => {
      renderBlock({ disabled: true });
      const radios = screen.getAllByRole("radio");
      radios.forEach((radio) => {
        expect(radio).toBeDisabled();
      });
    });

    it("passes disabled to MultiUserPicker", () => {
      renderBlock({ value: { mode: "whitelist" }, disabled: true });
      const picker = screen.getByTestId("multi-user-picker");
      expect(picker.dataset.disabled).toBe("true");
    });

    it("does not disable radios when disabled=false (default)", () => {
      renderBlock({ disabled: false });
      const radios = screen.getAllByRole("radio");
      radios.forEach((radio) => {
        expect(radio).not.toBeDisabled();
      });
    });
  });

  describe("onChange", () => {
    it("calls onChange with the new mode on radio click", () => {
      const { onChange } = renderBlock({ value: { mode: "owner-only" } });
      fireEvent.click(screen.getByLabelText(/same workspace/i));
      expect(onChange).toHaveBeenCalledWith({ mode: "same-tenant" });
    });
  });

  describe("section heading", () => {
    it("renders the Outbound DM heading", () => {
      renderBlock();
      expect(screen.getByText("Outbound DM")).toBeInTheDocument();
    });
  });
});
