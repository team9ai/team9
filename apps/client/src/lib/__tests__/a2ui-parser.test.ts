/**
 * Unit tests for the A2UI v0.9 payload parser.
 *
 * Each test builds a minimal but realistic three-message payload and asserts
 * that `parseChoicesPayload` produces the expected `ParsedChoicesSurface`.
 */

import { describe, it, expect } from "vitest";
import { parseChoicesPayload } from "../a2ui-parser";
import type { ParsedChoicesSurface } from "../a2ui-parser";

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

function makeCreateSurface(surfaceId = "choices-tc1") {
  return {
    version: "v0.9",
    createSurface: { surfaceId, catalogId: "cat-1", sendDataModel: true },
  };
}

interface OptionDef {
  label: string;
  value: string;
}

interface TabDef {
  title?: string;
  prompt: string;
  variant: "mutuallyExclusive" | "multipleSelection";
  options: OptionDef[];
  /** Descriptions aligned with options array (after stripping __other__). */
  descriptions?: (string | undefined)[];
  selected?: string[];
  otherText?: string;
}

/**
 * Build `updateComponents` for a single-tab surface (no Tabs component).
 */
function makeSingleTabComponents(tab: TabDef) {
  const components: unknown[] = [
    { id: "root", type: "Column", children: ["tab-0", "submit"] },
    { id: "tab-0", type: "Column", children: ["tab-0-prompt", "tab-0-picker"] },
    { id: "tab-0-prompt", type: "Text", text: tab.prompt, variant: "h3" },
    {
      id: "tab-0-picker",
      type: "ChoicePicker",
      variant: tab.variant,
      options: tab.options,
    },
    { id: "submit-label", type: "Text", text: "Submit" },
    { id: "submit", type: "Button", label: "Submit" },
  ];

  // Inject description components where specified.
  if (tab.descriptions) {
    tab.descriptions.forEach((desc, j) => {
      if (desc !== undefined) {
        components.push({
          id: `tab-0-opt-${j}-desc`,
          type: "Text",
          text: desc,
        });
      }
    });
  }

  // Inject other TextField if last option is __other__.
  const lastOpt = tab.options[tab.options.length - 1];
  if (lastOpt?.value === "__other__") {
    components.push({ id: "tab-0-other", type: "TextField" });
  }

  return { version: "v0.9", updateComponents: { components } };
}

/**
 * Build `updateComponents` for a multi-tab surface (includes Tabs component).
 */
function makeMultiTabComponents(tabs: TabDef[]) {
  const tabsComponent = {
    id: "tabs",
    type: "Tabs",
    tabs: tabs.map((t, i) => ({
      title: t.title ?? `Tab ${i + 1}`,
      child: `tab-${i}`,
    })),
  };

  const root = {
    id: "root",
    type: "Column",
    children: ["tabs", "submit"],
  };

  const components: unknown[] = [root, tabsComponent];

  tabs.forEach((tab, i) => {
    components.push(
      {
        id: `tab-${i}`,
        type: "Column",
        children: [`tab-${i}-prompt`, `tab-${i}-picker`],
      },
      { id: `tab-${i}-prompt`, type: "Text", text: tab.prompt, variant: "h3" },
      {
        id: `tab-${i}-picker`,
        type: "ChoicePicker",
        variant: tab.variant,
        options: tab.options,
      },
    );

    if (tab.descriptions) {
      tab.descriptions.forEach((desc, j) => {
        if (desc !== undefined) {
          components.push({
            id: `tab-${i}-opt-${j}-desc`,
            type: "Text",
            text: desc,
          });
        }
      });
    }

    const lastOpt = tab.options[tab.options.length - 1];
    if (lastOpt?.value === "__other__") {
      components.push({ id: `tab-${i}-other`, type: "TextField" });
    }
  });

  components.push(
    { id: "submit-label", type: "Text", text: "Submit" },
    { id: "submit", type: "Button", label: "Submit" },
  );

  return { version: "v0.9", updateComponents: { components } };
}

function makeDataModel(
  tabs: Array<{ selected: string[]; otherText?: string }>,
) {
  return {
    version: "v0.9",
    updateDataModel: {
      surfaceId: "choices-tc1",
      value: {
        tabs: tabs.map((t) => ({
          selected: t.selected,
          otherText: t.otherText ?? "",
        })),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseChoicesPayload", () => {
  // 1. Single tab, single-select, with __other__
  it("single tab single-select with Other strips __other__ and sets hasOther:true", () => {
    const payload = [
      makeCreateSurface("choices-s1"),
      makeSingleTabComponents({
        prompt: "Pick a color",
        variant: "mutuallyExclusive",
        options: [
          { label: "Red", value: "red" },
          { label: "Blue", value: "blue" },
          { label: "Other", value: "__other__" },
        ],
      }),
      makeDataModel([{ selected: ["red"] }]),
    ];

    const result = parseChoicesPayload(payload) as ParsedChoicesSurface;
    expect(result).not.toBeNull();
    expect(result.surfaceId).toBe("choices-s1");
    expect(result.tabs).toHaveLength(1);

    const tab = result.tabs[0];
    expect(tab.type).toBe("single-select");
    expect(tab.hasOther).toBe(true);
    expect(tab.options).toHaveLength(2);
    expect(tab.options.map((o) => o.value)).toEqual(["red", "blue"]);
    expect(tab.defaultSelected).toEqual(["red"]);
  });

  // 2. Single tab, multi-select, without Other
  it("single tab multi-select without Other", () => {
    const payload = [
      makeCreateSurface("choices-m1"),
      makeSingleTabComponents({
        prompt: "Choose fruits",
        variant: "multipleSelection",
        options: [
          { label: "Apple", value: "apple" },
          { label: "Banana", value: "banana" },
          { label: "Cherry", value: "cherry" },
        ],
      }),
      makeDataModel([{ selected: ["apple", "cherry"] }]),
    ];

    const result = parseChoicesPayload(payload) as ParsedChoicesSurface;
    expect(result).not.toBeNull();
    const tab = result.tabs[0];
    expect(tab.type).toBe("multi-select");
    expect(tab.hasOther).toBe(false);
    expect(tab.options).toHaveLength(3);
    expect(tab.defaultSelected).toEqual(["apple", "cherry"]);
  });

  // 3. Multi-tab mixed types (2 tabs via Tabs component)
  it("multi-tab layout uses Tabs component and produces one ParsedTab per tab", () => {
    const payload = [
      makeCreateSurface("choices-multi"),
      makeMultiTabComponents([
        {
          title: "Step 1",
          prompt: "Choose size",
          variant: "mutuallyExclusive",
          options: [
            { label: "Small", value: "s" },
            { label: "Large", value: "l" },
          ],
        },
        {
          title: "Step 2",
          prompt: "Choose extras",
          variant: "multipleSelection",
          options: [
            { label: "Cheese", value: "cheese" },
            { label: "Bacon", value: "bacon" },
          ],
        },
      ]),
      makeDataModel([{ selected: ["s"] }, { selected: ["cheese"] }]),
    ];

    const result = parseChoicesPayload(payload) as ParsedChoicesSurface;
    expect(result).not.toBeNull();
    expect(result.tabs).toHaveLength(2);
    expect(result.tabs[0].title).toBe("Step 1");
    expect(result.tabs[0].type).toBe("single-select");
    expect(result.tabs[1].title).toBe("Step 2");
    expect(result.tabs[1].type).toBe("multi-select");
  });

  // 4. Option descriptions are extracted
  it("extracts option descriptions from tab-{i}-opt-{j}-desc components", () => {
    const payload = [
      makeCreateSurface("choices-desc"),
      makeSingleTabComponents({
        prompt: "Choose a plan",
        variant: "mutuallyExclusive",
        options: [
          { label: "Free", value: "free" },
          { label: "Pro", value: "pro" },
          { label: "Enterprise", value: "enterprise" },
        ],
        descriptions: [
          "No cost, limited features",
          undefined,
          "Unlimited everything",
        ],
      }),
      makeDataModel([{ selected: [] }]),
    ];

    const result = parseChoicesPayload(payload) as ParsedChoicesSurface;
    expect(result).not.toBeNull();
    const opts = result.tabs[0].options;
    expect(opts[0].description).toBe("No cost, limited features");
    expect(opts[1].description).toBeUndefined();
    expect(opts[2].description).toBe("Unlimited everything");
  });

  // 5. defaultSelected is extracted from data model
  it("extracts defaultSelected from the updateDataModel message", () => {
    const payload = [
      makeCreateSurface("choices-dm"),
      makeSingleTabComponents({
        prompt: "Pick one",
        variant: "mutuallyExclusive",
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ],
      }),
      makeDataModel([{ selected: ["b"] }]),
    ];

    const result = parseChoicesPayload(payload) as ParsedChoicesSurface;
    expect(result!.tabs[0].defaultSelected).toEqual(["b"]);
  });

  // 6. Single tab without Tabs component still works
  it("single tab (no Tabs component) still parses correctly", () => {
    const payload = [
      makeCreateSurface("choices-notabs"),
      makeSingleTabComponents({
        prompt: "What is your goal?",
        variant: "mutuallyExclusive",
        options: [{ label: "Lose weight", value: "lose" }],
      }),
    ];

    const result = parseChoicesPayload(payload);
    expect(result).not.toBeNull();
    expect(result!.tabs).toHaveLength(1);
    expect(result!.tabs[0].prompt).toBe("What is your goal?");
  });

  // 7. Zero regular options + hasOther → empty options array with hasOther true
  it("handles picker with only __other__ option: empty options, hasOther true", () => {
    const payload = [
      makeCreateSurface("choices-onlyother"),
      makeSingleTabComponents({
        prompt: "Anything else?",
        variant: "mutuallyExclusive",
        options: [{ label: "Other", value: "__other__" }],
      }),
      makeDataModel([{ selected: [] }]),
    ];

    const result = parseChoicesPayload(payload) as ParsedChoicesSurface;
    expect(result).not.toBeNull();
    const tab = result.tabs[0];
    expect(tab.hasOther).toBe(true);
    expect(tab.options).toHaveLength(0);
  });

  // 8. Option without description → description key absent (undefined)
  it("option without matching desc component has undefined description", () => {
    const payload = [
      makeCreateSurface("choices-nodesc"),
      makeSingleTabComponents({
        prompt: "Naked options",
        variant: "mutuallyExclusive",
        options: [
          { label: "Alpha", value: "alpha" },
          { label: "Beta", value: "beta" },
        ],
        // no descriptions provided
      }),
      makeDataModel([{ selected: [] }]),
    ];

    const result = parseChoicesPayload(payload) as ParsedChoicesSurface;
    expect(result!.tabs[0].options[0].description).toBeUndefined();
    expect(result!.tabs[0].options[1].description).toBeUndefined();
  });

  // 9. Empty defaultSelected (no data model message)
  it("returns empty defaultSelected when updateDataModel is absent", () => {
    const payload = [
      makeCreateSurface("choices-nodata"),
      makeSingleTabComponents({
        prompt: "Choose",
        variant: "mutuallyExclusive",
        options: [{ label: "X", value: "x" }],
      }),
      // no data model message
    ];

    const result = parseChoicesPayload(payload) as ParsedChoicesSurface;
    expect(result).not.toBeNull();
    expect(result.tabs[0].defaultSelected).toEqual([]);
  });

  // 10. Unparseable / empty payload → null
  it("returns null for empty payload", () => {
    expect(parseChoicesPayload([])).toBeNull();
  });

  it("returns null for non-array input", () => {
    expect(parseChoicesPayload(null as any)).toBeNull();
  });

  it("returns null when createSurface message is missing", () => {
    const payload = [
      makeSingleTabComponents({
        prompt: "X",
        variant: "mutuallyExclusive",
        options: [{ label: "A", value: "a" }],
      }),
    ];
    expect(parseChoicesPayload(payload)).toBeNull();
  });

  it("returns null when updateComponents message is missing", () => {
    const payload = [makeCreateSurface()];
    expect(parseChoicesPayload(payload)).toBeNull();
  });

  // 11. Missing picker component → null
  it("returns null when a picker component is absent for a tab", () => {
    // Build updateComponents without the picker
    const badComponents = {
      version: "v0.9",
      updateComponents: {
        components: [
          { id: "root", type: "Column", children: ["tab-0", "submit"] },
          { id: "tab-0", type: "Column", children: ["tab-0-prompt"] },
          {
            id: "tab-0-prompt",
            type: "Text",
            text: "No picker here",
            variant: "h3",
          },
          // deliberately no tab-0-picker
        ],
      },
    };

    const payload = [makeCreateSurface(), badComponents];
    expect(parseChoicesPayload(payload)).toBeNull();
  });

  it("returns null when a prompt component is absent for a tab", () => {
    const badComponents = {
      version: "v0.9",
      updateComponents: {
        components: [
          { id: "root", type: "Column", children: ["tab-0", "submit"] },
          { id: "tab-0", type: "Column", children: ["tab-0-picker"] },
          // deliberately no tab-0-prompt
          {
            id: "tab-0-picker",
            type: "ChoicePicker",
            variant: "mutuallyExclusive",
            options: [{ label: "A", value: "a" }],
          },
        ],
      },
    };

    const payload = [makeCreateSurface(), badComponents];
    expect(parseChoicesPayload(payload)).toBeNull();
  });

  // Multi-tab with empty tabs array → null
  it("returns null when Tabs component has empty tabs array", () => {
    const badComponents = {
      version: "v0.9",
      updateComponents: {
        components: [
          { id: "root", type: "Column", children: ["tabs", "submit"] },
          { id: "tabs", type: "Tabs", tabs: [] },
        ],
      },
    };

    const payload = [makeCreateSurface(), badComponents];
    expect(parseChoicesPayload(payload)).toBeNull();
  });

  // Graceful handling of corrupt/non-object messages
  it("returns null for payload containing non-object items", () => {
    expect(
      parseChoicesPayload([null, undefined, 42, "string"] as unknown[]),
    ).toBeNull();
  });

  // updateComponents.components not an array → null
  it("returns null when updateComponents.components is not an array", () => {
    const badMsg = {
      version: "v0.9",
      updateComponents: { components: "not-an-array" },
    };
    const payload = [makeCreateSurface(), badMsg];
    expect(parseChoicesPayload(payload)).toBeNull();
  });

  // surfaceId missing from createSurface → null
  it("returns null when surfaceId is absent from createSurface", () => {
    const badCreate = {
      version: "v0.9",
      createSurface: { catalogId: "cat-1" },
    };
    const payload = [
      badCreate,
      makeSingleTabComponents({
        prompt: "X",
        variant: "mutuallyExclusive",
        options: [{ label: "A", value: "a" }],
      }),
    ];
    expect(parseChoicesPayload(payload)).toBeNull();
  });

  // Multi-tab: per-tab descriptions and defaults
  it("multi-tab: each tab gets correct options, descriptions, and defaultSelected", () => {
    const payload = [
      makeCreateSurface("choices-multi-full"),
      makeMultiTabComponents([
        {
          title: "Colors",
          prompt: "Pick a color",
          variant: "mutuallyExclusive",
          options: [
            { label: "Red", value: "red" },
            { label: "Green", value: "green" },
          ],
          descriptions: ["Warm hue", "Cool hue"],
        },
        {
          title: "Sizes",
          prompt: "Pick sizes",
          variant: "multipleSelection",
          options: [
            { label: "S", value: "s" },
            { label: "M", value: "m" },
            { label: "Other", value: "__other__" },
          ],
          descriptions: [undefined, undefined],
        },
      ]),
      makeDataModel([{ selected: ["green"] }, { selected: ["s", "m"] }]),
    ];

    const result = parseChoicesPayload(payload) as ParsedChoicesSurface;
    expect(result).not.toBeNull();

    const tab0 = result.tabs[0];
    expect(tab0.title).toBe("Colors");
    expect(tab0.options[0].description).toBe("Warm hue");
    expect(tab0.options[1].description).toBe("Cool hue");
    expect(tab0.defaultSelected).toEqual(["green"]);

    const tab1 = result.tabs[1];
    expect(tab1.title).toBe("Sizes");
    expect(tab1.hasOther).toBe(true);
    expect(tab1.options).toHaveLength(2);
    expect(tab1.defaultSelected).toEqual(["s", "m"]);
  });
});
