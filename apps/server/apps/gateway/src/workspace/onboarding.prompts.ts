import type { OnboardingTasksContextDto } from './dto/onboarding.dto.js';

export type OnboardingLanguage =
  | 'en'
  | 'zh'
  | 'zh-TW'
  | 'ja'
  | 'ko'
  | 'es'
  | 'pt'
  | 'fr'
  | 'de'
  | 'it'
  | 'nl'
  | 'ru';

const SUPPORTED_ONBOARDING_LANGUAGES: readonly OnboardingLanguage[] = [
  'en',
  'zh',
  'zh-TW',
  'ja',
  'ko',
  'es',
  'pt',
  'fr',
  'de',
  'it',
  'nl',
  'ru',
];

const LANGUAGE_DISPLAY_NAMES: Record<OnboardingLanguage, string> = {
  en: 'English',
  zh: 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  nl: 'Dutch',
  ru: 'Russian',
};

function targetLanguage(lang: OnboardingLanguage) {
  return LANGUAGE_DISPLAY_NAMES[lang] ?? 'English';
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
  lang: OnboardingLanguage;
}) {
  return `
=========================
OUTPUT LANGUAGE (HIGHEST PRIORITY)
=========================
- ALL user-facing string values you output MUST be written in ${targetLanguage(args.lang)}.
- This rule overrides any language used in the examples below. Examples are illustrative only — DO NOT copy their language.
- Identifiers like JSON keys, enum slugs, and emoji stay as-is; only natural-language values must be in ${targetLanguage(args.lang)}.

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

export function normalizeOnboardingLanguage(lang?: string): OnboardingLanguage {
  if (!lang) return 'en';
  const lower = lang.toLowerCase().replace('_', '-');

  if (lower === 'zh' || lower.startsWith('zh-hans') || lower === 'zh-cn') {
    return 'zh';
  }
  if (lower.startsWith('zh-hant') || lower === 'zh-tw' || lower === 'zh-hk') {
    return 'zh-TW';
  }

  const primary = lower.split('-')[0];
  const match = SUPPORTED_ONBOARDING_LANGUAGES.find(
    (code) => code.toLowerCase() === primary,
  );
  return match ?? 'en';
}

const MAIN_AGENT_NAMES: Record<OnboardingLanguage, string> = {
  en: 'Personal Staff',
  zh: '私人秘书',
  'zh-TW': '私人秘書',
  ja: 'パーソナルスタッフ',
  ko: '퍼스널 스태프',
  es: 'Personal Staff',
  pt: 'Assistente Pessoal',
  fr: 'Assistant personnel',
  de: 'Persönlicher Assistent',
  it: 'Assistente personale',
  nl: 'Persoonlijke assistent',
  ru: 'Личный помощник',
};

export function onboardingMainAgentName(lang: OnboardingLanguage) {
  return MAIN_AGENT_NAMES[lang] ?? MAIN_AGENT_NAMES.en;
}

export function buildGenerateTasksPrompt(args: {
  roleLabel?: string | null;
  roleSlug?: string | null;
  categoryKey?: string | null;
  description?: string | null;
  lang: OnboardingLanguage;
}) {
  const roleContextMap: Record<string, string> = {
    finance:
      args.lang === 'zh'
        ? '金融专业人士经常处理的是：市场分析与研究、投资组合管理、风险评估、合规审查、报告与数据汇总、客户沟通与需求确认。'
        : 'Finance professionals regularly work on: market analysis and research, portfolio management, risk assessment, compliance reviews, report generation and data consolidation, client communication and needs confirmation.',
    legal:
      args.lang === 'zh'
        ? '法律专业人士经常处理的是：案件/事务管理、法律文件起草与审查、合规监控、法律研究、客户咨询、诉讼准备。'
        : 'Legal professionals regularly work on: case/matter management, legal document drafting and review, compliance monitoring, legal research, client consultation, litigation preparation.',
    consulting:
      args.lang === 'zh'
        ? '咨询顾问经常处理的是：项目进展跟踪、客户访谈与需求调研、数据分析与建议整理、提案撰写、内部协调与同步。'
        : 'Consultants regularly work on: project progress tracking, client interviews and needs research, data analysis and recommendations, proposal writing, internal coordination and sync.',
    marketing:
      args.lang === 'zh'
        ? '营销专业人士经常处理的是：内容规划与创建、活动运营、数据分析与优化、渠道管理、竞争对手监控、客户互动。'
        : 'Marketing professionals regularly work on: content planning and creation, campaign execution, data analysis and optimization, channel management, competitor monitoring, customer engagement.',
    sales:
      args.lang === 'zh'
        ? '销售专业人士经常处理的是：客户管理与跟进、销售漏斗管理、提案准备、合同协商、交易推进、客户维护。'
        : 'Sales professionals regularly work on: customer management and follow-up, sales pipeline management, proposal preparation, contract negotiation, deal advancement, customer retention.',
    ecommerce:
      args.lang === 'zh'
        ? '电商专业人士经常处理的是：数据监控与优化、库存管理、商品上新与优化、营销活动、客户服务与反馈、供应链协调。'
        : 'E-commerce professionals regularly work on: data monitoring and optimization, inventory management, product listing and optimization, marketing campaigns, customer service and feedback, supply chain coordination.',
    creator:
      args.lang === 'zh'
        ? '内容创作者经常处理的是：内容创意与策划、内容制作与编辑、内容分发与发布、读者/观众互动、数据反馈分析。'
        : 'Content creators regularly work on: content ideation and planning, content production and editing, content distribution and publishing, audience interaction, performance analytics.',
    design:
      args.lang === 'zh'
        ? '设计专业人士经常处理的是：设计需求沟通、创意方案设计、版本迭代与反馈、设计规范维护、交付与标注。'
        : 'Design professionals regularly work on: design requirement communication, creative concept development, version iteration and feedback, design system maintenance, delivery and annotation.',
    engineering:
      args.lang === 'zh'
        ? '工程师经常处理的是：功能开发、代码审查、bug 修复、测试与部署、技术文档、团队协作与问题排查。'
        : 'Engineers regularly work on: feature development, code review, bug fixes, testing and deployment, technical documentation, team collaboration and troubleshooting.',
    ai:
      args.lang === 'zh'
        ? 'AI 专业人士经常处理的是：AI 工具评估、提示词优化、自动化工作流设计、数据准备、效果评测、团队培训。'
        : 'AI professionals regularly work on: AI tool evaluation, prompt optimization, automation workflow design, data preparation, performance evaluation, team training.',
    education:
      args.lang === 'zh'
        ? '教育工作者经常处理的是：课程设计与备课、教学实施与评估、学生管理与反馈、教材准备、专业发展。'
        : 'Educators regularly work on: curriculum design and lesson planning, teaching delivery and assessment, student management and feedback, material preparation, professional development.',
  };

  const categoryContext = args.categoryKey
    ? roleContextMap[args.categoryKey]
    : '';
  const contextStr =
    categoryContext ||
    (args.lang === 'zh'
      ? '根据用户的角色和描述，推断其真实的工作流程。'
      : "Based on the user's role and description, infer their actual recurring workflows.");

  return `
${buildSharedOnboardingPrompt(args)}

Current onboarding step:
- Step 2: Task Selection

Step goal:
- Generate 3 DAILY task candidates that reflect the user's actual, high-frequency, must-do daily work—the kind of tasks they execute every single workday.

Work context for this role category:
${contextStr}

Definition of a real daily task:
- A daily-recurring workflow the user would plausibly execute every workday (NOT weekly, NOT monthly, NOT one-off projects).
- Central to this role's daily rhythm — the kind of check, review, briefing, or update that anchors the user's morning, shift, or end-of-day wrap.
- A concrete, bounded action or output the user can picture themselves doing today, not a generic label like "admin" or "planning".
- Tied to this user's specific role/description context, not applicable to any job in any industry.

Good case examples (by role type — notice every title opens with the daily marker):
- For a Trader: "Daily position review", "Daily market open briefing", "Daily P&L and risk report"
- For a Product Manager: "Daily user feedback triage", "Daily metrics dashboard review", "Daily team standup and priorities"
- For a Designer: "Daily design critique round", "Daily mockup iteration", "Daily asset export check"
- For a Lawyer: "Daily case docket review", "Daily compliance alert scan", "Daily client correspondence review"
- For a Salesperson: "Daily pipeline update", "Daily client follow-up calls", "Daily outreach batch"

Chinese reference (same daily-prefix pattern in 每日):
- 交易员: "每日仓位检查"、"每日开盘简报"、"每日盈亏与风险汇报"
- 产品经理: "每日用户反馈梳理"、"每日指标巡检"、"每日站会与优先级对齐"
- 律师: "每日案件进度审阅"、"每日合规提醒巡查"、"每日客户往来函件处理"

Bad case (what NOT to generate):
- Missing the daily marker at the start: "Position review" without "Daily", "仓位检查" without "每日" — every title MUST open with the language's daily marker.
- Wrong cadence: "Weekly roadmap review", "Monthly compliance audit", "Quarterly planning" — cadence MUST be daily.
- Generic tasks: "Plan your day", "Review goals", "Team meeting", "Admin work"
- One-off projects: "Launch new product", "Rebranding initiative", "Office relocation"
- Vague or too broad: "Stay organized", "Improve performance", "Drive growth"
- Repeated ideas: "Daily content creation", "Daily content planning", "Daily content management" (all the same workflow with the prefix slapped on)
- Disconnected from role: A designer being asked to "manage payroll" or a lawyer being asked to "run paid ads"

Output requirements:
- Return exactly 3 daily tasks.
- Every "title" MUST open with ${targetLanguage(args.lang)}'s natural "daily" marker so the cadence is unmistakable at first glance. Use the pattern appropriate to the language:
  - English → start with "Daily " (e.g., "Daily position review")
  - Simplified Chinese → 以 "每日" 开头 (例: "每日仓位检查")
  - Traditional Chinese → 以 "每日" 開頭 (例: "每日倉位檢查")
  - Japanese → 「毎日」で始める (例: 「毎日のポジション確認」)
  - Korean → "매일"로 시작 (예: "매일 포지션 점검")
  - German → mit "Tägliche/Täglicher/Tägliches" beginnen (z. B. "Tägliche Positionsprüfung")
  - Dutch → met "Dagelijkse" beginnen (bv. "Dagelijkse positiecontrole")
  - Russian → начинать со слова "Ежедневный/Ежедневная/Ежедневное" (напр. "Ежедневная проверка позиций")
  - Spanish → comenzar con "Revisión/Control/Informe diario de ..." (el marcador "diario/diaria" aparece dentro de las dos primeras palabras)
  - Portuguese → começar com "Revisão/Controle/Relatório diário de ..."
  - Italian → iniziare con "Revisione/Controllo/Report giornaliero di ..."
  - French → commencer par "Revue/Contrôle/Rapport quotidien(ne) de ..."
  For Romance/French cases where the adjective naturally follows the noun, lead with the noun but keep the daily adjective within the first two words so the cadence is still visible at a glance.
- Each task is concretely specific and role-aware — the user should immediately recognize themselves in at least one.
- Tasks should span different responsibilities or phases of this role's daily work (not three flavors of the same thing with the prefix re-used).
- Put the emoji in the "emoji" field and keep the "title" field plain text.
- Keep titles concise, natural, and UI-friendly.
- Every "title" value MUST be written in ${targetLanguage(args.lang)}, regardless of the language used in the examples above.

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
  lang: OnboardingLanguage;
}) {
  const selectedTaskTitles =
    args.tasks?.generatedTasks
      ?.filter((task) => args.tasks?.selectedTaskIds?.includes(task.id))
      .map((task) => task.title.trim()) ?? [];

  const tasksContext =
    selectedTaskTitles.length > 0
      ? args.lang === 'zh'
        ? `用户选中的任务：${selectedTaskTitles.join('、')}。这些任务反映了用户的关键工作流程，频道应该支持这些工作流。`
        : `User's selected tasks: ${selectedTaskTitles.join(', ')}. These reflect key workflows that channels should support.`
      : '';

  return `
${buildSharedOnboardingPrompt(args)}

Current onboarding step:
- Step 3: Channel Setup

Step goal:
- Generate 4 channel names that serve as stable workstreams where this user would actually conduct work—not generic catch-alls, but real functional spaces tied to their role.

${tasksContext}

Definition of a real channel:
- A durable, recurring place for a specific work function, project, client, or operating cadence (not a one-off topic).
- Named to make the purpose immediately clear: A new team member joining could instantly know what conversation belongs here.
- Useful for both one-to-one collaboration and team-wide coordination around that function.
- Tied to this user's actual work, not universal productivity labels.

Good case examples (by role type):
- For Sales: "Deal Pipeline", "Client Success", "Proposal Review", "Sales Metrics"
- For Legal: "Contract Review Queue", "Compliance Tracking", "Litigation Cases", "Client Matters"
- For Design: "Design Critiques", "Component Library", "Feedback Rounds", "Asset Management"
- For Engineering: "Code Review", "Bug Tracking", "Release Planning", "Technical Discussions"
- For Marketing: "Campaign Calendar", "Content Review", "Performance Analytics", "Campaign Briefs"

Bad case (what NOT to generate):
- Generic buckets: "General", "Announcements", "Random", "Chat", "To-Do", "Ideas", "Notes", "Resources"
- Abstract catch-alls: "Collaboration", "Discussions", "Updates", "Meetings"
- Too broad: "Work", "Project", "Team", "Office"
- One-off projects: "Website Redesign", "Q3 Campaign", "New Hire Onboarding" (unless this is a permanent function)
- Redundant or overlapping: "Feedback" and "Review" and "Critiques" (all the same function)

Output requirements:
- Return exactly 4 channel names.
- Each channel must serve a distinct, functional purpose tied to this user's work.
- Names should be noun-based (e.g., "Client Reviews" not "Review Clients").
- Short, clear, and immediately understandable.
- Plain channel names are enough; the product will handle formatting.
- Every "name" value MUST be written in ${targetLanguage(args.lang)}, regardless of the language used in the examples above.

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
  lang: OnboardingLanguage;
}) {
  const selectedTaskTitles =
    args.tasks?.generatedTasks
      ?.filter((task) => args.tasks?.selectedTaskIds?.includes(task.id))
      .map((task) => task.title.trim()) ?? [];

  const tasksContext =
    selectedTaskTitles.length > 0
      ? args.lang === 'zh'
        ? `用户选中的任务：${selectedTaskTitles.join('、')}。这些任务反映了用户最常做的工作，agent 应该直接支持这些工作流。`
        : `User's selected tasks: ${selectedTaskTitles.join(', ')}. These are the user's most frequent workflows; agents should directly support them.`
      : '';

  const mainAgentContextMap: Record<string, string> = {
    finance:
      args.lang === 'zh'
        ? '私人秘书应该协调投资分析、合规检查、客户沟通等核心工作，确保所有金融决策和交互有据可依。'
        : 'Personal Staff should coordinate investment analysis, compliance checks, client communication, and ensure all financial decisions and interactions are well-documented.',
    legal:
      args.lang === 'zh'
        ? '私人秘书应该协调案件管理、法律研究、合规监控，确保每个法律事务都有清晰的进展追踪。'
        : 'Personal Staff should coordinate case management, legal research, compliance monitoring, and ensure clear progress tracking on every legal matter.',
    consulting:
      args.lang === 'zh'
        ? '私人秘书应该协调项目进展、客户互动、数据整理，确保咨询工作有条理且客户反馈被及时处理。'
        : 'Personal Staff should coordinate project progress, client engagement, data organization, and ensure consulting work stays organized with timely client feedback.',
    sales:
      args.lang === 'zh'
        ? '私人秘书应该协调销售漏斗管理、客户跟进、交易推进，确保每条线索都被妥善跟踪和推进。'
        : 'Personal Staff should coordinate sales pipeline management, customer follow-up, deal advancement, and ensure every lead is tracked and progressed.',
    marketing:
      args.lang === 'zh'
        ? '私人秘书应该协调活动运营、内容发布、数据分析，确保营销工作有节奏且数据驱动。'
        : 'Personal Staff should coordinate campaign execution, content publishing, data analysis, and ensure marketing work stays rhythmic and data-driven.',
  };

  const mainAgentContext = args.categoryKey
    ? mainAgentContextMap[args.categoryKey]
    : '';
  const mainAgentStr =
    mainAgentContext ||
    (args.lang === 'zh'
      ? '私人秘书应该根据用户的角色和工作特点，协调和优化用户的核心工作流程。'
      : "Personal Staff should coordinate and optimize the user's core workflows based on their role and work patterns.");

  return `
${buildSharedOnboardingPrompt(args)}

Current onboarding step:
- Step 4: Agent Configuration

Step goal:
- Generate a starter agent lineup where each agent is a concrete, actionable delegate for a distinct part of this user's work—not generic assistants, but functional specialists.

Main agent context:
${mainAgentStr}

${tasksContext}

Definition of a useful child agent:
- A clear, single responsibility tied to the user's actual work (not a generic "assistant" or "helper").
- Something the user would realistically delegate or automate in their daily workflow.
- Named after the function it performs, not a cute mascot or abstract title.
- Complementary to the other agents—covers a different phase, client type, or workflow aspect.

Good case examples (by role type):
- For Sales: "Lead Qualifier" (researches and scores leads), "Proposal Generator" (drafts custom proposals), "Client Tracker" (monitors deal status and next steps)
- For Legal: "Contract Analyst" (reviews and flags issues in contracts), "Case Manager" (tracks deadlines and document status), "Compliance Auditor" (monitors regulatory changes)
- For Design: "Design Reviewer" (gathers and synthesizes feedback), "Component Manager" (maintains design system), "Asset Organizer" (catalogs and tags assets)
- For Marketing: "Content Scheduler" (plans and publishes content), "Analytics Monitor" (tracks performance and reports), "Campaign Manager" (oversees campaign execution)
- For Engineering: "Code Reviewer" (reviews code and suggests improvements), "Bug Tracker" (triages and prioritizes bugs), "Deploy Manager" (coordinates releases)

Bad case (what NOT to generate):
- Generic titles: "Assistant", "Helper", "Operator", "Agent", "Support"
- Overlapping functions: "Content Creator", "Content Manager", "Content Coordinator" (all the same role)
- Too abstract: "Strategist", "Organizer", "Optimizer" (meaningless without context)
- Disconnected from role: A lawyer with a "Marketing Specialist" agent, a designer with a "Sales Closer" agent
- Cute/unclear: "Bobby the Buddy", "Charlie the Chatbot" (hide actual responsibility)

Output requirements:
- The main agent name is fixed to ${onboardingMainAgentName(args.lang)}.
- Return one short, clear main description (1 sentence, no marketing speak).
- Generate exactly 3 child agents, each with one fitting emoji and one clear functional name.
- Each child agent name should be a role title or function (e.g., "Lead Qualifier", not "Qualify Leads").
- Every "description" and child agent "name" value MUST be written in ${targetLanguage(args.lang)}, regardless of the language used in the examples above.

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
