// Mock file tree that powers the Workfile tab demo. All content lives in
// memory; no network calls, no persistence. Shape matches the minimum the
// @cubone/react-file-manager needs, plus a `markdown` field for preview.

export interface WorkfileEntry {
  /** Absolute POSIX-style path, always starting with "/". Root entries are "/name". */
  path: string;
  name: string;
  isDirectory: boolean;
  updatedAt: string;
  size?: number;
  /** Inlined markdown body. Only set when isDirectory is false. */
  markdown?: string;
}

const now = "2026-04-12T18:32:00Z";
const earlier = "2026-04-11T17:55:00Z";
const kickoff = "2026-04-01T09:00:00Z";

export const MOCK_WORKFILES: WorkfileEntry[] = [
  // ── Root-level files ───────────────────────────────────────────
  {
    path: "/README.md",
    name: "README.md",
    isDirectory: false,
    updatedAt: kickoff,
    size: 612,
    markdown: `# Performance Cycle Coordinator — Workfile

This folder is the agent's working scratch space. Everything here is
created and maintained by the agent itself while running performance
cycles end-to-end.

## Layout

- \`playbooks/\` — reusable guides the agent follows every cycle.
- \`q2-cycle/\` — the current cycle's working docs.
- \`users/\` — per-person briefs (preferences, goals, context).
- \`customers/\` — customer-specific notes for enterprise accounts.
- \`diary/\` — daily narrative summaries written at end of day.
- \`scratchpad.md\` — fast-moving jotting space, not curated.

## Update policy

The agent auto-commits to files here whenever it learns something new.
Humans can read, but should not edit — the agent will overwrite.
`,
  },
  {
    path: "/scratchpad.md",
    name: "scratchpad.md",
    isDirectory: false,
    updatedAt: now,
    size: 284,
    markdown: `# Scratchpad

- Chase Winrey for finance loop-in decision.
- Acme rubric request — still pending.
- Draft an email for the self-review reminder that doesn't sound robotic.
- Try shifting calibration to 2026-05-06 morning (Winrey's calendar looked open).
- [ ] Revisit peer-review pairings on 2026-04-14.
`,
  },

  // ── playbooks/ ─────────────────────────────────────────────────
  {
    path: "/playbooks",
    name: "playbooks",
    isDirectory: true,
    updatedAt: kickoff,
  },
  {
    path: "/playbooks/review-playbook.md",
    name: "review-playbook.md",
    isDirectory: false,
    updatedAt: kickoff,
    size: 1420,
    markdown: `# Performance review playbook

## How I run a quarterly cycle

1. **Kick-off** — socialize the timeline 3 weeks before calibration.
2. **Self-review window** — 5 business days, reminders on day 3 and day 5.
3. **Peer review pairing** — at least 2 peers per reviewee, balanced across teams.
4. **Manager writeups** — due 48h before calibration.
5. **Calibration** — cross-functional, always in person or fully on camera.
6. **Delivery** — written-first, 1:1 conversation within 3 days.

## Hard rules

- No surprise feedback in the final delivery.
- Every rating needs a cited artifact (PR, doc, incident, customer note).
- Managers read the written version aloud with the reviewee in the room.

## Anti-patterns to catch

- Compliment sandwiches (especially from newer managers).
- Goal sandbagging — "I want to grow into X" with no concrete artifact.
- Silent calibration (nobody disagrees) — ask deliberate probing questions.
`,
  },
  {
    path: "/playbooks/calibration-guide.md",
    name: "calibration-guide.md",
    isDirectory: false,
    updatedAt: "2026-04-05T10:00:00Z",
    size: 980,
    markdown: `# Calibration guide

## Facilitator checklist

1. Read every reviewee's name aloud before starting discussion.
2. Force one peer comment per reviewee, even if just "nothing surprising."
3. Park comp discussion — calibration is about performance, not money.
4. Capture dissent explicitly in notes. If nobody pushed back, that's a smell.

## Groupings

- **Engineering** — by IC / senior IC / staff+ / manager, cross-team.
- **PM, Design, Ops** — by level, grouped across teams.

## Timing

- 90 minutes cap per group.
- 5-minute breaks every 45 minutes. People stop being useful after that.
`,
  },
  {
    path: "/playbooks/rubric-template.md",
    name: "rubric-template.md",
    isDirectory: false,
    updatedAt: "2026-04-02T11:00:00Z",
    size: 740,
    markdown: `# Rubric template

| Dimension | 1 — Below | 3 — Meets | 5 — Exceeds |
|---|---|---|---|
| **Craft** | Needs frequent rework | Ships on-spec, few bugs | Lifts team-wide quality |
| **Ownership** | Waits to be told | Takes initiative in own area | Drives cross-team outcomes |
| **Communication** | Hard to follow | Clear in writing and meetings | Unblocks others through clarity |
| **Trust** | Surprises downstream | Delivers what's promised | Makes everyone around them look good |

Every rating requires a cited artifact (PR link, doc, customer note).
`,
  },

  // ── q2-cycle/ ──────────────────────────────────────────────────
  {
    path: "/q2-cycle",
    name: "q2-cycle",
    isDirectory: true,
    updatedAt: now,
  },
  {
    path: "/q2-cycle/timeline.md",
    name: "timeline.md",
    isDirectory: false,
    updatedAt: "2026-04-01T15:00:00Z",
    size: 640,
    markdown: `# Q2 perf cycle — timeline

| Milestone | Date |
|---|---|
| Kickoff announcement | 2026-04-11 |
| Self-review opens | 2026-04-15 |
| Self-review closes | 2026-04-22 |
| Peer review window | 2026-04-22 → 2026-04-29 |
| Manager writeups due | 2026-05-04 |
| Calibration | 2026-05-06 |
| Delivery window | 2026-05-07 → 2026-05-11 |

**Blackout dates:** 2026-05-01 (company holiday), 2026-04-28 (board meeting — Winrey unavailable).
`,
  },
  {
    path: "/q2-cycle/kickoff-notes.md",
    name: "kickoff-notes.md",
    isDirectory: false,
    updatedAt: "2026-04-11T17:55:00Z",
    size: 420,
    markdown: `# Q2 kickoff — notes

- Announcement sent 2026-04-11 at 09:12.
- 14 reviewees in scope; 11 acknowledged by end of day.
- Self-review tool link: \`perf-app://q2-2026\` (demo placeholder).

## Open items from kickoff call
- Finance loop-in decision (pending Winrey).
- Acme Corp rubric share (pending Winrey + legal).
`,
  },
  {
    path: "/q2-cycle/calibration-draft.md",
    name: "calibration-draft.md",
    isDirectory: false,
    updatedAt: now,
    size: 860,
    markdown: `# Calibration — working draft

> This is a draft. Don't share outside the perf group.

## Scale

Locked in as 5-point with behavioral anchors (agreed with Winrey on 2026-04-12).

## Groupings

- **Engineering (IC)** — cross-team, level-grouped.
- **Engineering (Manager)** — separate group.
- **PM / Design / Ops** — single group, level-grouped.

## Facilitator

Rotating. **Winrey is explicitly out for her own directs** (her ask).

## Open items

- [ ] Replace Jt as a peer reviewer in the team-he's-being-reviewed-in.
- [ ] Draft email template for delivery handoff.
- [ ] Decide on finance loop-in.
`,
  },

  // ── users/ ─────────────────────────────────────────────────────
  {
    path: "/users",
    name: "users",
    isDirectory: true,
    updatedAt: "2026-04-02T14:10:00Z",
  },
  {
    path: "/users/winrey.md",
    name: "winrey.md",
    isDirectory: false,
    updatedAt: "2026-04-02T14:10:00Z",
    size: 520,
    markdown: `# Winrey Ma

**Role:** Workspace owner, Q2 perf cycle sponsor.

## Feedback style

- **Written first.** Hand her the written version *before* the conversation.
- **Direct, no hedging.** Soft openings feel like wasted tokens.
- **Concrete artifacts.** PRs, docs, incident numbers — always cited.
- **Short verbal 1:1s.** 20 minutes is target; go long only when she asks.

## Avoid

- Compliment sandwiches.
- Grouping multiple reviewees in one thread.
`,
  },
  {
    path: "/users/jt.md",
    name: "jt.md",
    isDirectory: false,
    updatedAt: "2026-04-05T11:30:00Z",
    size: 540,
    markdown: `# Jt Chen

**Role:** Engineering lead (6 reports). Being reviewed this cycle.

## Q2 goals (self-reported, not manager-endorsed yet)

1. Ship the new auth middleware by end of April.
2. Grow one senior engineer into a tech-lead role (shadow + hand-off).
3. Reduce on-call paging noise by 40% (Q1 baseline from Grafana).

## Note
Goal #3 has a cross-team dependency on the alerting cleanup project.
Flag this at calibration.

## Conflict
Currently assigned as a peer reviewer for two people in the same team
he's being reviewed in. **Recommended swap.**
`,
  },

  // ── customers/ ─────────────────────────────────────────────────
  {
    path: "/customers",
    name: "customers",
    isDirectory: true,
    updatedAt: "2026-04-09T13:20:00Z",
  },
  {
    path: "/customers/acme-requirements.md",
    name: "acme-requirements.md",
    isDirectory: false,
    updatedAt: "2026-04-09T13:20:00Z",
    size: 680,
    markdown: `# Acme Corp · custom perf cycle requirements

Acme has asked for **two deviations** from our standard playbook:

1. **Quarterly instead of bi-annual.** Their internal cadence is
   aligned to quarterly board updates.
2. **Anonymous peer review.** Their legal team requires peer identities
   be stripped before delivery.

## Outstanding request

Account owner Priya R. asked whether we'd share our rubric template as
a starting point. **Pending Winrey's approval** — do NOT send the
template until confirmed.

## Contacts

- support@acme.example
- Account owner: Priya R.
`,
  },

  // ── diary/ ─────────────────────────────────────────────────────
  {
    path: "/diary",
    name: "diary",
    isDirectory: true,
    updatedAt: now,
  },
  {
    path: "/diary/2026-04-11.md",
    name: "2026-04-11.md",
    isDirectory: false,
    updatedAt: earlier,
    size: 430,
    markdown: `# Diary · 2026-04-11

## What I did today

- Read through last quarter's calibration retro. Two patterns to carry forward:
  1. Peer-review pairings should avoid reporting chains.
  2. Written delivery consistently beats verbal-first in reviewee satisfaction.
- Set up the 2026 Q2 project in the tracker and linked the rubric draft.

## Mood / meta
Light day. Tomorrow is the real kick-off.
`,
  },
  {
    path: "/diary/2026-04-12.md",
    name: "2026-04-12.md",
    isDirectory: false,
    updatedAt: now,
    size: 780,
    markdown: `# Diary · 2026-04-12

## What I did today

- Sent the self-review reminder to 14 reviewees. 11 acknowledged.
- Paired with **Winrey** on the Q2 calibration rubric — agreed on a
  5-point scale with explicit behavioral anchors.
- Drafted first-pass calibration groupings for the eng org.
- Flagged a conflict: **Jt** is being reviewed *and* is a peer reviewer
  for two people in the same team. Recommended swapping one peer.

## Open questions for tomorrow

- Does Winrey want finance looped into calibration or only at the comp step?
- Acme Corp asked whether we can share our rubric template. Need to
  confirm with Winrey first.

## What went well

- The new reminder cadence cut non-responses in half vs last cycle.
`,
  },
];
