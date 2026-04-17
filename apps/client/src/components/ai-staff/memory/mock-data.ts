import type { MemoryRecord, MemorySubject, MemoryType } from "./types";

export const MOCK_TYPES: MemoryType[] = [
  {
    name: "agent",
    description:
      "The staff itself. Holds agent-scoped knowledge, playbooks, and diary entries.",
    externalIdSpec: "agent slug, e.g. pcc-agent-01",
    isCustom: false,
  },
  {
    name: "user",
    description:
      "A human the agent collaborates with. Stores preferences, goals, feedback style.",
    externalIdSpec: "internal userId or handle",
    isCustom: false,
  },
  {
    name: "project",
    description:
      "An initiative or workstream the agent contributes to. Scopes project-specific context.",
    externalIdSpec: "project slug",
    isCustom: false,
  },
  {
    name: "date",
    description:
      "A single calendar day. Narrative summary of what happened and what was decided.",
    externalIdSpec: "ISO date, e.g. 2026-04-12",
    isCustom: false,
  },
  {
    name: "customer",
    description:
      "A customer account. Stores account-specific requirements and preferences.",
    externalIdSpec: "customer slug",
    isCustom: true,
  },
];

export const MOCK_SUBJECTS: MemorySubject[] = [
  {
    id: "sub-agent-pcc",
    type: "agent",
    externalId: "pcc-agent-01",
    name: "Performance Cycle Coordinator",
    description: "This staff. Runs quarterly performance cycles end-to-end.",
  },
  {
    id: "sub-user-winrey",
    type: "user",
    externalId: "winrey",
    name: "Winrey Ma",
    description: "Workspace owner. Sponsor of the Q2 perf cycle.",
  },
  {
    id: "sub-user-jt",
    type: "user",
    externalId: "jt",
    name: "Jt Chen",
    description: "Engineering lead being reviewed this cycle.",
  },
  {
    id: "sub-proj-q2",
    type: "project",
    externalId: "q2-perf-cycle",
    name: "Q2 Performance Cycle",
    description: "2026 Q2 company-wide performance review cycle.",
  },
  {
    id: "sub-date-0412",
    type: "date",
    externalId: "2026-04-12",
    name: "2026-04-12",
  },
  {
    id: "sub-date-0411",
    type: "date",
    externalId: "2026-04-11",
    name: "2026-04-11",
  },
  {
    id: "sub-cust-acme",
    type: "customer",
    externalId: "acme",
    name: "Acme Corp",
    description: "Enterprise customer with custom performance cycle needs.",
  },
];

export const MOCK_MEMORIES: MemoryRecord[] = [
  {
    id: "mem-playbook",
    title: "Performance review playbook",
    markdown: `## How I run a quarterly cycle

1. **Kick-off** — socialize the timeline 3 weeks before calibration.
2. **Self-review window** — 5 business days, reminders on day 3 and day 5.
3. **Peer review pairing** — at least 2 peers per reviewee, balanced across teams.
4. **Manager writeups** — due 48h before calibration.
5. **Calibration** — cross-functional, always in person or fully on camera.
6. **Delivery** — written-first, 1:1 conversation within 3 days.

### Hard rules
- No surprise feedback in the final delivery.
- Every rating needs a cited artifact (PR, doc, incident, customer note).
- Managers read the written version aloud with the reviewee in the room.
`,
    source: "agent:pcc-agent-01/self-authored",
    holderSubjectIds: ["sub-agent-pcc"],
    connections: [{ kind: "main", targetSubjectId: "sub-proj-q2" }],
    createdAt: "2026-04-01T09:00:00Z",
  },
  {
    id: "mem-diary-0412",
    title: "Diary · 2026-04-12",
    markdown: `## What I did today

- Sent the self-review reminder to 14 reviewees. 11 acknowledged.
- Paired with **Winrey** on the Q2 calibration rubric — agreed on a 5-point scale with explicit behavioral anchors.
- Drafted first-pass calibration groupings for the eng org.
- Flagged a conflict: **Jt** is being reviewed *and* is a peer reviewer for two people in the same team. Recommended swapping one peer.

## Open questions for tomorrow
- Does Winrey want finance looped into calibration or only at the comp step?
- Acme Corp asked whether we can share our rubric template. Need to confirm with Winrey first.

## What went well
- The new reminder cadence cut non-responses in half vs last cycle.
`,
    source: "session:2026-04-12T18:32/diary-auto",
    holderSubjectIds: ["sub-agent-pcc"],
    connections: [
      { kind: "main", targetSubjectId: "sub-date-0412" },
      { kind: "main", targetSubjectId: "sub-proj-q2" },
      { kind: "weak", targetSubjectId: "sub-user-winrey" },
      { kind: "weak", targetSubjectId: "sub-user-jt" },
      { kind: "weak", targetSubjectId: "sub-cust-acme" },
    ],
    createdAt: "2026-04-12T18:32:00Z",
  },
  {
    id: "mem-diary-0411",
    title: "Diary · 2026-04-11",
    markdown: `## What I did today

- Read through last quarter's calibration retro. Two patterns to carry forward:
  1. Peer-review pairings should avoid reporting chains.
  2. Written delivery consistently beats verbal-first in reviewee satisfaction.
- Set up the 2026 Q2 project in the tracker and linked the rubric draft.

## Mood / meta
- Light day. Tomorrow is the real kick-off.
`,
    source: "session:2026-04-11T17:50/diary-auto",
    holderSubjectIds: ["sub-agent-pcc"],
    connections: [
      { kind: "main", targetSubjectId: "sub-date-0411" },
      { kind: "weak", targetSubjectId: "sub-proj-q2" },
      { kind: "weak", targetMemoryId: "mem-playbook" },
    ],
    createdAt: "2026-04-11T17:50:00Z",
  },
  {
    id: "mem-winrey-feedback-style",
    title: "Feedback style preferences",
    markdown: `**Winrey prefers:**

- **Written first.** Always hand the written version over *before* the conversation — never read it aloud cold.
- **Direct, no hedging.** Soft openings feel like wasted tokens to her. Get to the point in sentence one.
- **Concrete artifacts.** Cite PRs, docs, incident numbers. "Good leadership" without an example is a red flag to her.
- **Short verbal 1:1s.** 20 minutes is the target; go long only when the reviewee asks.

**Avoid:**
- Compliment sandwiches.
- Grouping multiple reviewees in one thread.
`,
    source: "chat://channel/team-perf/msg/8f3a12",
    holderSubjectIds: ["sub-user-winrey"],
    connections: [
      { kind: "main", targetSubjectId: "sub-agent-pcc" },
      { kind: "weak", targetSubjectId: "sub-proj-q2" },
    ],
    createdAt: "2026-04-02T14:10:00Z",
  },
  {
    id: "mem-winrey-reports",
    title: "Reports-to structure",
    markdown: `Winrey's direct reports for Q2 calibration:

- **Jt Chen** — engineering lead, 6 reports.
- 3 more TBD once org changes finalize next week.

She's asked to *not* be the calibration facilitator for her own directs — wants an independent voice in the room.
`,
    source: "doc://org-chart/2026-Q2",
    holderSubjectIds: ["sub-user-winrey"],
    connections: [
      { kind: "main", targetSubjectId: "sub-proj-q2" },
      { kind: "main", targetSubjectId: "sub-user-jt" },
    ],
    createdAt: "2026-04-03T10:00:00Z",
  },
  {
    id: "mem-jt-goals",
    title: "Q2 performance goals",
    markdown: `Goals Jt set at cycle kickoff (self-reported, not yet manager-endorsed):

1. Ship the new auth middleware by end of April.
2. Grow one of the senior engineers into a tech-lead role (shadow + hand-off).
3. Reduce on-call paging noise by 40% (baseline from Q1 Grafana).

Note: goal #3 depends on the alerting cleanup project — cross-team dependency, should be flagged at calibration.
`,
    source: "session:2026-04-05T11:00/kickoff-transcript",
    holderSubjectIds: ["sub-user-jt"],
    connections: [
      { kind: "main", targetSubjectId: "sub-proj-q2" },
      { kind: "weak", targetSubjectId: "sub-user-winrey" },
    ],
    createdAt: "2026-04-05T11:30:00Z",
  },
  {
    id: "mem-q2-timeline",
    title: "Timeline & milestones",
    markdown: `## Q2 perf cycle — key dates

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
    source: "doc://perf-cycle/q2-timeline.md",
    holderSubjectIds: ["sub-proj-q2"],
    connections: [
      { kind: "main", targetSubjectId: "sub-date-0411" },
      { kind: "main", targetSubjectId: "sub-date-0412" },
      { kind: "weak", targetMemoryId: "mem-playbook" },
    ],
    createdAt: "2026-04-01T15:00:00Z",
  },
  {
    id: "mem-q2-calibration",
    title: "Calibration meeting notes (draft)",
    markdown: `Pre-calibration decisions locked in so far:

- **Scale:** 5-point with explicit behavioral anchors (agreed with Winrey on 2026-04-12).
- **Groupings:** by function, not by team. Eng / PM / Design / Ops.
- **Facilitator:** rotating; Winrey explicitly out for her own directs.
- **Artifacts required:** every rating above 3 or below 3 needs a cited artifact.

Open items:
- Finance loop-in — still pending Winrey's call.
- Acme Corp rubric share — pending legal/Winrey review.
`,
    source: "agent:pcc-agent-01/draft-2026-04-12",
    holderSubjectIds: ["sub-proj-q2"],
    connections: [
      { kind: "weak", targetSubjectId: "sub-agent-pcc" },
      { kind: "weak", targetSubjectId: "sub-user-winrey" },
      { kind: "weak", targetSubjectId: "sub-cust-acme" },
    ],
    createdAt: "2026-04-12T17:00:00Z",
  },
  {
    id: "mem-date-0412-summary",
    title: "Daily summary · 2026-04-12",
    markdown: `## 2026-04-12 — narrative

Quiet morning. Afternoon was the Q2 kickoff work session with Winrey — aligned on the 5-point scale and behavioral anchors. Flagged the Jt peer-reviewer conflict. Acme Corp surfaced a request about rubric templates that needs a decision.

**Decisions made today**
- 5-point calibration scale with behavioral anchors.
- Jt's peer reviewer assignment will be swapped (no decision on replacement yet).

**People who showed up**
- Winrey Ma (sponsor)
- Jt Chen (mentioned, not present)
`,
    source: "session:2026-04-12T18:32/diary-auto",
    holderSubjectIds: ["sub-date-0412"],
    connections: [
      { kind: "main", targetSubjectId: "sub-agent-pcc" },
      { kind: "weak", targetSubjectId: "sub-user-winrey" },
      { kind: "weak", targetSubjectId: "sub-user-jt" },
      { kind: "weak", targetMemoryId: "mem-diary-0412" },
    ],
    createdAt: "2026-04-12T18:40:00Z",
  },
  {
    id: "mem-date-0411-summary",
    title: "Daily summary · 2026-04-11",
    markdown: `## 2026-04-11 — narrative

Setup day. Reviewed last cycle's retro and set up the Q2 project in the tracker. Nothing customer-facing.

**Decisions made today**
- None locked in. Just prep.
`,
    source: "session:2026-04-11T17:50/diary-auto",
    holderSubjectIds: ["sub-date-0411"],
    connections: [
      { kind: "main", targetSubjectId: "sub-agent-pcc" },
      { kind: "weak", targetMemoryId: "mem-diary-0411" },
    ],
    createdAt: "2026-04-11T17:55:00Z",
  },
  {
    id: "mem-acme-requirements",
    title: "Acme Corp · custom perf cycle requirements",
    markdown: `Acme has asked for **two deviations** from our standard playbook:

1. **Quarterly instead of bi-annual** — their internal cadence is aligned to quarterly board updates.
2. **Anonymous peer review** — their legal team requires peer identities be stripped before delivery.

Account owner is asking whether we'd share our rubric template as a starting point. **Pending Winrey's approval** — do NOT send the template until confirmed.

Contact: support@acme.example / account owner Priya R.
`,
    source: "chat://channel/customer-acme/msg/2c41a9",
    holderSubjectIds: ["sub-cust-acme"],
    connections: [
      { kind: "weak", targetSubjectId: "sub-user-winrey" },
      { kind: "weak", targetMemoryId: "mem-playbook" },
    ],
    createdAt: "2026-04-09T13:20:00Z",
  },
];
