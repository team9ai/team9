/**
 * A2UI v0.9 payload parser for the PresentChoices surface.
 *
 * The PresentChoices agent tool emits 3 messages:
 *   1. createSurface  – surface identity
 *   2. updateComponents – flat component list describing the UI layout
 *   3. updateDataModel  – initial/default selected values
 *
 * This module parses those 3 messages into a structured `ParsedChoicesSurface`
 * suitable for rendering choice UI in the dashboard.
 */

export interface ParsedOption {
  value: string;
  label: string;
  description?: string;
}

export interface ParsedTab {
  title: string;
  prompt: string;
  type: "single-select" | "multi-select";
  options: ParsedOption[];
  hasOther: boolean;
  defaultSelected: string[];
}

export interface ParsedChoicesSurface {
  surfaceId: string;
  tabs: ParsedTab[];
}

/** The sentinel option value used by PresentChoices for the free-text "other" slot. */
const OTHER_VALUE = "__other__";

/**
 * Parse a three-message A2UI v0.9 payload produced by the `PresentChoices` tool.
 *
 * @param payload - Array of raw message objects (order does not matter).
 * @returns Parsed surface, or `null` if the payload cannot be interpreted.
 */
export function parseChoicesPayload(
  payload: unknown[],
): ParsedChoicesSurface | null {
  try {
    if (!Array.isArray(payload) || payload.length === 0) return null;

    // Locate the three expected messages by their discriminant key.
    const createMsg = payload.find(
      (m): m is Record<string, unknown> =>
        m !== null && typeof m === "object" && "createSurface" in (m as object),
    ) as Record<string, unknown> | undefined;

    const componentsMsg = payload.find(
      (m): m is Record<string, unknown> =>
        m !== null &&
        typeof m === "object" &&
        "updateComponents" in (m as object),
    ) as Record<string, unknown> | undefined;

    const dataModelMsg = payload.find(
      (m): m is Record<string, unknown> =>
        m !== null &&
        typeof m === "object" &&
        "updateDataModel" in (m as object),
    ) as Record<string, unknown> | undefined;

    if (!createMsg || !componentsMsg) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const createSurface = createMsg.createSurface as any;
    const surfaceId = createSurface?.surfaceId as string | undefined;
    if (!surfaceId) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateComponents = componentsMsg.updateComponents as any;
    const components: unknown[] = updateComponents?.components;
    if (!Array.isArray(components)) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findComp = (id: string): any =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      components.find((c: any) => c?.id === id);

    // Determine tab count and titles.
    // Multi-tab: a Tabs component exists with a `tabs` array.
    // Single-tab: no Tabs component; fall back to the prompt text.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tabsComp: any = findComp("tabs");
    let tabCount: number;
    let tabTitles: string[];

    if (tabsComp) {
      if (!Array.isArray(tabsComp.tabs) || tabsComp.tabs.length === 0)
        return null;
      tabCount = tabsComp.tabs.length;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tabTitles = tabsComp.tabs.map((t: any) => (t?.title as string) ?? "");
    } else {
      // Single-tab mode: there is no explicit tab title in the A2UI payload.
      // Use the prompt text as the title, or fall back to "Selection".
      tabCount = 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promptComp: any = findComp("tab-0-prompt");
      tabTitles = [(promptComp?.text as string) ?? "Selection"];
    }

    // Extract data-model defaults if present.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateDataModel = (dataModelMsg?.updateDataModel as any)?.value as
      | { tabs: Array<{ selected: string[]; otherText: string }> }
      | undefined;

    const tabs: ParsedTab[] = [];

    for (let i = 0; i < tabCount; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promptComp: any = findComp(`tab-${i}-prompt`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pickerComp: any = findComp(`tab-${i}-picker`);

      if (!promptComp || !pickerComp) return null;

      const prompt = promptComp.text as string;
      const pickerVariant = pickerComp.variant as string;
      const type: "single-select" | "multi-select" =
        pickerVariant === "multipleSelection"
          ? "multi-select"
          : "single-select";

      // Separate __other__ from regular options.
      const rawOptions: Array<{ label: string; value: string }> = Array.isArray(
        pickerComp.options,
      )
        ? pickerComp.options
        : [];

      const hasOther =
        rawOptions.length > 0 &&
        rawOptions[rawOptions.length - 1].value === OTHER_VALUE;

      const regularOptions = hasOther
        ? rawOptions.slice(0, -1)
        : [...rawOptions];

      // Attach per-option descriptions from `tab-{i}-opt-{j}-desc` Text components.
      const options: ParsedOption[] = regularOptions.map((opt, j) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const descComp: any = findComp(`tab-${i}-opt-${j}-desc`);
        const description = descComp?.text as string | undefined;
        return {
          value: opt.value,
          label: opt.label,
          ...(description !== undefined ? { description } : {}),
        };
      });

      // Default selections from data model (tab index aligned).
      const defaultSelected: string[] =
        updateDataModel?.tabs?.[i]?.selected ?? [];

      tabs.push({
        title: tabTitles[i] ?? `Tab ${i + 1}`,
        prompt,
        type,
        options,
        hasOther,
        defaultSelected,
      });
    }

    return { surfaceId, tabs };
  } catch {
    return null;
  }
}
