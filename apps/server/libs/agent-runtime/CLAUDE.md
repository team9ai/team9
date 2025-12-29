# @team9/agent-runtime

Agent Runtime - Debug server for AI agents. Provides REST API and SSE endpoints for the Agent Debugger frontend.

## Package Info

- **Name**: `@team9/agent-runtime`
- **Version**: 0.0.1
- **Entry**: `./src/index.ts`
- **Framework**: Hono (lightweight web framework)

## Dependencies

- `@team9/agent-framework` - Core agent framework
- `hono` - Web framework
- `@hono/node-server` - Node.js adapter for Hono

## Directory Structure

```
agent-runtime/
├── src/
│   ├── index.ts           # Main export
│   ├── server.ts          # Server entry point
│   ├── routes/            # API routes
│   │   ├── agents.ts      # Agent management endpoints
│   │   ├── blueprints.ts  # Blueprint management endpoints
│   │   ├── debug.ts       # Debug control endpoints
│   │   └── batch-test.ts  # Batch testing endpoints
│   ├── services/          # Business logic
│   │   ├── agent.service.ts
│   │   ├── blueprint.service.ts
│   │   └── batch-test.service.ts
│   ├── sse/               # Server-Sent Events
│   │   └── agent-events.ts
│   └── types/             # Type definitions
│       └── index.ts
└── package.json
```

## API Endpoints

### Agent Management

- `POST /api/agents` - Create agent from blueprint
- `GET /api/agents` - List all agents
- `GET /api/agents/:id` - Get agent details
- `DELETE /api/agents/:id` - Delete agent

### Debug Control

- `POST /api/agents/:id/inject` - Inject event
- `POST /api/agents/:id/fork` - Fork from state
- `PUT /api/agents/:id/chunks/:cid` - Edit chunk

### Execution Mode Control

- `GET /api/agents/:id/execution-mode` - Get execution mode status
- `PUT /api/agents/:id/execution-mode` - Set execution mode (auto/stepping)
- `POST /api/agents/:id/step` - Execute single step in stepping mode

## Types

Re-exports from `@team9/agent-framework`:

- `ExecutionMode` - `'auto' | 'stepping'`
- `StepResult` - Result of step operation
- `AgentStatus` - `'processing' | 'waiting_internal' | 'awaiting_input' | 'paused' | 'completed' | 'error'`
- `EventDispatchStrategy` - `'queue' | 'interrupt' | 'terminate' | 'silent'`

### Real-time Events (SSE)

- `GET /api/agents/:id/events` - Subscribe to agent events

### Batch Testing

- `POST /api/batch-test` - Run batch test
- `GET /api/batch-test/:id` - Get test result

## Running

```bash
# Development
pnpm dev

# Production
pnpm start
```
