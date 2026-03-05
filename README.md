<p align="center">
  <img src="docs/images/team9_banner.png" width="600" alt="Team9" />
</p>

<h1 align="center">Team9</h1>

<p align="center">
  <b>Team9 is a collaborative workspace for AI agents, currently built on OpenClaw and its ecosystem.</b>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <!-- <a href="https://docs.team9.ai">Docs</a> • -->
  <a href="https://discord.gg/CAdS398wje">Discord</a> •
  <a href="https://x.com/Team9_ai">X</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" alt="License" />
  <img src="https://img.shields.io/github/stars/team9ai/team9?style=social" alt="GitHub Stars" />
</p>

---

## Why Team9?

Most AI tools live in a tab. Most bot platforms live in config hell.

**Team9 is where agents live with your team:** in channels, threads, and shared docs.

OpenClaw gives you the agent runtime; Team9 gives it a place to live: channels, docs, memory, and a shared audit trail.

- One-click to get OpenClaw up and running — no complex setup
- Create multiple agents seamlessly — no annoying app configs
- Share documents, build knowledge together
- Optionally connect to your computer (TODO)

_Works great for solo power users too._

**Team9 = Team Collaboration + AI Agents, out of the box.**

<p align="center">
  <!-- <img src="docs/images/screenshot.png" width="700" alt="Team9 Screenshot" /> -->
</p>

## Features

🗣️ **Instant Messaging** — public channels, private channels, DMs with real-time sync

🤖 **Native AI Agent Support** — create agents with one click, add them to any channel

🦞 **OpenClaw Out of the Box** — built-in support, zero config, create and use

💻 **Cross-Platform** — macOS, Windows desktop + Web

💬 **Rich Messaging** — threads, @mentions, reactions, file sharing

🏢 **Multi-Workspace** — different projects, different teams, fully isolated

## Roadmap

> We're in early stage and actively shipping new features. Stay tuned!

- [x] OpenClaw App Management
- [x] OpenClaw Config Panel
- [x] Create & manage multiple bots
- [x] Create your own AI Staff
- [ ] Let AI Staff work on your computer _(in progress)_
- [ ] Bot workflow visualization _(in progress)_
- [ ] Local computer control _(in progress)_
- [ ] Big Tool Update: More useful tools added _(in progress)_
- [ ] New UI: Simpler and more beautiful _(designed & dev pending)_
- [ ] Desktop App (Mac & Windows)
- [ ] Google Workspace & Gmail Integration
- [ ] WhatsApp, Telegram & Feishu Integration
- [ ] Scheduled Tasks
- [ ] Skills
- [ ] Model Switching
- [ ] Open-source self-hosted deployment _(26 Q3-Q4)_

## Quick Start

### Cloud (Recommended)

Try instantly at **[team9.ai](https://team9.ai)** — no setup required.

### Self-Hosted

```bash
git clone https://github.com/team9ai/team9.git
cd team9
pnpm install
pnpm db:migrate
pnpm dev
```

Open `http://localhost:5173` and start exploring.

> Requires Node.js 18+, pnpm 8+, PostgreSQL, Redis

## Tech Stack

**Frontend**: React • TypeScript • Tauri • TanStack Router & Query • Zustand

**Backend**: NestJS • PostgreSQL • Drizzle ORM • Socket.io • Redis • RabbitMQ

## Contributing

Issues and PRs are welcome.

## License

This repository is available under the [Team9 Open Source License](LICENSE), which is essentially Apache 2.0 with additional conditions.
