import type { SkillType } from "@/types/skill";

export interface SkillTemplate {
  id: string;
  name: string;
  descriptionKey: string;
  type: SkillType;
  files: { path: string; content: string }[];
}

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    id: "claude-code-skill",
    name: "template.claudeCodeSkill",
    descriptionKey: "template.claudeCodeSkillDescription",
    type: "claude_code_skill",
    files: [
      {
        path: "skill.md",
        content: `---
name: my-skill
description: Describe what this skill does and when to use it
---

# My Skill

## Overview

Describe the skill's purpose and behavior here.

## Instructions

- Step-by-step instructions for the agent
- Use clear, actionable language
- Include examples when helpful

## Examples

\`\`\`
Example input → Expected output
\`\`\`
`,
      },
    ],
  },
  {
    id: "prompt-template",
    name: "template.promptTemplate",
    descriptionKey: "template.promptTemplateDescription",
    type: "prompt_template",
    files: [
      {
        path: "prompt.md",
        content: `# {{task_name}}

## Context

You are helping with {{context}}.

## Instructions

{{instructions}}

## Output Format

Provide your response in the following format:
- Summary
- Key findings
- Recommendations
`,
      },
      {
        path: "variables.json",
        content: JSON.stringify(
          {
            variables: [
              {
                name: "task_name",
                description: "Name of the task",
                required: true,
              },
              {
                name: "context",
                description: "Context for the task",
                required: true,
              },
              {
                name: "instructions",
                description: "Specific instructions",
                required: false,
                default: "Follow best practices",
              },
            ],
          },
          null,
          2,
        ),
      },
    ],
  },
];
