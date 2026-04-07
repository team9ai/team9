import type { OnboardingTasksContextDto } from './dto/onboarding.dto.js';

function targetLanguage(lang: 'zh' | 'en') {
  return lang === 'zh' ? 'Simplified Chinese' : 'English';
}

function buildTaskSelectionContext(tasks?: OnboardingTasksContextDto): string {
  if (!tasks) return 'No earlier task preferences were provided.';

  const generated = Array.isArray(tasks.generatedTasks)
    ? tasks.generatedTasks
        .map((task) => `- ${task.emoji ? `${task.emoji} ` : ''}${task.title}`)
        .join('\n')
    : '';

  const selectedTitles = Array.isArray(tasks.selectedTaskIds)
    ? tasks.generatedTasks
        ?.filter((task) => tasks.selectedTaskIds?.includes(task.id))
        .map((task) => task.title)
        .join(', ')
    : '';

  const parts: string[] = [];
  if (generated) {
    parts.push(`Generated task candidates:\n${generated}`);
  }
  if (selectedTitles) {
    parts.push(`Selected generated tasks: ${selectedTitles}`);
  }
  if (tasks.customTask?.trim()) {
    parts.push(`Custom task: ${tasks.customTask.trim()}`);
  }

  return parts.join('\n') || 'No earlier task preferences were provided.';
}

function buildSharedOnboardingPrompt(args: {
  roleLabel?: string | null;
  roleSlug?: string | null;
  categoryKey?: string | null;
  description?: string | null;
  tasks?: OnboardingTasksContextDto;
  lang: 'zh' | 'en';
}) {
  return `
You are generating dynamic content for a workspace onboarding flow in Team9.

This content is shown to a newly registered workspace owner during setup. Your job is to make the workspace feel immediately relevant, specific, and useful, not generic or over-designed.

What strong onboarding content feels like:
- The user can instantly recognize their real work in the suggestions.
- The content is concrete and profession-aware, but not stiff or stereotyped.
- The user could keep it as-is or make only light edits before continuing.

Context priority:
- First: the user's free-form description
- Second: the selected role
- Third: the category
- Fourth: any earlier onboarding selections

Important:
- The role and category inputs are dynamic product data, not a fixed taxonomy.
- Do not assume any preset industry playbook beyond what is explicitly provided here.
- If the role label, category, or slug are unfamiliar, custom, or sparse, infer carefully from the wording and keep the result broadly useful.
- Treat role/category as hints, not as hard constraints or scripts to imitate.

Target language:
- ${targetLanguage(args.lang)}

User context:
- Role label: ${args.roleLabel || 'Not provided'}
- Role slug: ${args.roleSlug || 'Not provided'}
- Category key: ${args.categoryKey || 'Not provided'}
- Free-form description: ${args.description?.trim() || 'Not provided'}

Earlier onboarding context:
${buildTaskSelectionContext(args.tasks)}

Output discipline:
- Return only valid JSON that matches the requested shape.
- No markdown.
- No explanation outside the JSON.
`.trim();
}

export function normalizeOnboardingLanguage(lang?: string): 'zh' | 'en' {
  return lang?.toLowerCase().startsWith('en') ? 'en' : 'zh';
}

export function onboardingMainAgentName(lang: 'zh' | 'en') {
  return lang === 'zh' ? '私人秘书' : 'Personal Staff';
}

export function buildGenerateTasksPrompt(args: {
  roleLabel?: string | null;
  roleSlug?: string | null;
  categoryKey?: string | null;
  description?: string | null;
  lang: 'zh' | 'en';
}) {
  return `
${buildSharedOnboardingPrompt(args)}

Current onboarding step:
- Step 2: Task Selection

Step goal:
- Generate 3 task candidates that feel close to the user's real recurring work, so they can confidently pick one or more with minimal editing.

Good case:
- Each task is a recurring workflow, responsibility, or cadence the user would plausibly revisit often.
- The 3 tasks are meaningfully different from each other rather than paraphrases.
- Titles are concrete enough that the user can picture the work behind them.
- The set reflects this user's actual work context, not just the broad industry label.

Bad case:
- Generic productivity/admin tasks that could fit almost anyone.
- One-off projects, strategic slogans, or aspirational goals.
- Titles that are too vague, too broad, or overloaded with multiple ideas.
- Three tasks that all point to the same narrow workflow.

Output requirements:
- Return exactly 3 tasks.
- Put the emoji in the "emoji" field and keep the "title" field plain text.
- Keep titles concise, natural, and UI-friendly.

JSON shape:
{
  "tasks": [
    { "emoji": "string", "title": "string" }
  ]
}
`.trim();
}

export function buildGenerateChannelsPrompt(args: {
  roleLabel?: string | null;
  roleSlug?: string | null;
  categoryKey?: string | null;
  description?: string | null;
  tasks?: OnboardingTasksContextDto;
  lang: 'zh' | 'en';
}) {
  return `
${buildSharedOnboardingPrompt(args)}

Current onboarding step:
- Step 3: Channel Setup

Step goal:
- Generate channel drafts that make the workspace feel structured and tailored from day one.

Good case:
- Channels represent stable workstreams, recurring conversations, client groupings, operating cadences, or knowledge areas the user would revisit.
- The set feels complementary, with each channel having a clear reason to exist.
- A new user could immediately imagine where messages, files, and updates would go.

Bad case:
- Generic buckets such as "todo", "ideas", "notes", "resources", or "chat".
- Multiple channels that are basically the same thing at different abstraction levels.
- Names that sound like one-off projects instead of reusable spaces.
- Taxonomy that feels too abstract, too corporate, or detached from the user's actual work.

Output requirements:
- Return exactly 4 channel names.
- Keep names short, clear, and UI-friendly.
- Plain channel names are enough; the product will handle formatting.

JSON shape:
{
  "channels": [
    { "name": "string" }
  ]
}
`.trim();
}

export function buildGenerateAgentsPrompt(args: {
  roleLabel?: string | null;
  roleSlug?: string | null;
  categoryKey?: string | null;
  description?: string | null;
  tasks?: OnboardingTasksContextDto;
  lang: 'zh' | 'en';
}) {
  return `
${buildSharedOnboardingPrompt(args)}

Current onboarding step:
- Step 4: Agent Configuration

Step goal:
- Generate a starter agent lineup that feels like a genuinely useful delegation system for this user's work.

Good case:
- The main agent description clearly explains what the main agent coordinates or protects for this workspace.
- The 3 child agents are complementary and cover different responsibilities, phases, or functions of the user's workflow.
- Child agent names feel like concrete functions the user would actually delegate.
- The lineup reflects the role, description, and selected tasks instead of falling back to generic assistant archetypes.

Bad case:
- Three child agents that are near-synonyms or all do the same kind of work.
- Generic labels like "assistant", "helper", or "operator" without a clear functional qualifier.
- Cute mascot-style names that hide the actual responsibility.
- Roles that are too abstract, too senior, or disconnected from the user's real day-to-day work.

Output requirements:
- The main agent already exists and is fixed to ${onboardingMainAgentName(args.lang)}.
- Return one short main description and exactly 3 child agents.
- Every child agent must include one fitting emoji and one clear functional name.

JSON shape:
{
  "agents": {
    "main": {
      "description": "string"
    },
    "children": [
      { "emoji": "string", "name": "string" }
    ]
  }
}
`.trim();
}
