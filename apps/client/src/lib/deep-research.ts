export type DeepResearchMode = "standard" | "max";
export type DeepResearchVisualization = "auto" | "off";

export interface DeepResearchComposerConfig {
  mode: DeepResearchMode;
  visualization: DeepResearchVisualization;
}

export const DEFAULT_DEEP_RESEARCH_CONFIG: DeepResearchComposerConfig = {
  mode: "standard",
  visualization: "auto",
};

export function getDeepResearchAgent(mode: DeepResearchMode): string {
  return mode === "max"
    ? "deep-research-max-preview-04-2026"
    : "deep-research-preview-04-2026";
}

export function buildDeepResearchAgentConfig(options: {
  collaborativePlanning: boolean;
  visualization?: DeepResearchVisualization;
}): Record<string, unknown> {
  return {
    type: "deep-research",
    thinkingSummaries: "auto",
    thinking_summaries: "auto",
    visualization: options.visualization ?? "auto",
    collaborativePlanning: options.collaborativePlanning,
    collaborative_planning: options.collaborativePlanning,
  };
}

export function buildDeepResearchTools(options: {
  includeUploadedFiles: boolean;
}): Array<Record<string, unknown>> {
  return [
    { type: "google_search" },
    { type: "url_context" },
    { type: "code_execution" },
    ...(options.includeUploadedFiles
      ? [{ type: "file_search", source: "team9_attachments" }]
      : []),
  ];
}

export function buildDeepResearchRequestMetadata(
  config: DeepResearchComposerConfig,
  options: { attachmentCount: number },
): Record<string, unknown> {
  const includeUploadedFiles = options.attachmentCount > 0;
  const agentConfig = buildDeepResearchAgentConfig({
    collaborativePlanning: true,
    visualization: config.visualization,
  });

  return {
    deepResearchRequest: {
      source: "team9",
      kind: "request",
      agent: getDeepResearchAgent(config.mode),
      mode: config.mode,
      background: true,
      stream: true,
      requestPlanFirst: true,
      agentConfig,
      agent_config: agentConfig,
      sources: {
        googleSearch: true,
        uploadedFiles: includeUploadedFiles,
      },
      tools: buildDeepResearchTools({ includeUploadedFiles }),
    },
  };
}
