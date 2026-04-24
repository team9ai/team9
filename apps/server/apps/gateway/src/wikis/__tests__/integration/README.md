# Wiki ↔ folder9 integration test

End-to-end test that exercises the gateway's `WikisService` /
`WikisController` against a **real** folder9 instance running in Docker.

The Team9 database is still mocked (via the same chain-mock pattern used by
`wikis.service.spec.ts`). Only the folder9 HTTP boundary is real — this is
the boundary we actually need integration confidence on. See the block
comment at the top of `wiki-folder9.integration.spec.ts` for the full
trade-off rationale.

## What it covers

| Flow | Description |
|------|-------------|
| F1   | `createWiki` provisions a real folder9 folder (`getFolder` round-trip) |
| F2   | `commitPage` in `auto` mode → `getPage` returns the committed content with frontmatter parsed |
| F3   | `commitPage` in `review` mode → proposal created → `listProposals` returns it → `approveProposal` → `getPage` reflects the new content |
| F4   | folder9 webhook HMAC signature round-trip (controller accepts a signed payload and broadcasts the right event) |

All flows route through `WikisService` / `Folder9WebhookController` — the
test never calls `Folder9ClientService` directly except in F1 where it
independently verifies the folder was created.

## Opt-in gate

The suite is **skipped by default** and only runs when `INTEGRATION=1` is in
the environment. This keeps `pnpm test` fast and free of Docker
prerequisites. See `INTEGRATION_ENABLED` at the bottom of the spec for the
mechanism.

## Prerequisites

- Docker + `docker compose`
- A local folder9 checkout (default path assumption is that `folder9/` sits
  next to your `team9/` checkout — if not, set `FOLDER9_BUILD_CONTEXT`)
- Ports `58080` (folder9) and `55432` (postgres) free on localhost

## Run it

### 1. Start folder9 + postgres

```bash
cd apps/server/apps/gateway/src/wikis/__tests__/integration

# Option A: build from a local folder9 checkout (default)
FOLDER9_BUILD_CONTEXT=/path/to/folder9 \
  docker compose up -d --build

# Option B: use a published image
FOLDER9_IMAGE=team9ai/folder9:latest \
  docker compose up -d

# Wait for both services to be healthy:
docker compose ps
```

### 2. Run the test

From the repo root:

```bash
INTEGRATION=1 pnpm --filter @team9/gateway test -- wiki-folder9.integration
```

The test polls `http://localhost:58080/healthz` in `beforeAll` so a slow
cold-start is tolerated (up to 60s by default). Override the base URL with
`FOLDER9_INTEGRATION_URL` if you're running folder9 on a non-default host
or port.

### 3. Clean up

```bash
cd apps/server/apps/gateway/src/wikis/__tests__/integration
docker compose down -v   # -v also drops the postgres + data volumes
```

The test's `afterAll` hook best-effort-deletes any folders it created, so
between runs you can leave the containers up — only the postgres / data
volumes accumulate state worth cleaning.

## Normal test runs (no docker)

```bash
pnpm --filter @team9/gateway test
```

The integration suite contains a `describe.skip` block when `INTEGRATION`
is not `1`, plus a visible `it.skip('skipped unless INTEGRATION=1 is set …')`
placeholder so the Jest summary makes the gating obvious rather than
silently producing zero runs.
