# Managed App Auto-Install on Access

**Date:** 2026-04-13
**Status:** Approved
**Scope:** Backend — `InstalledApplicationsService`

## Problem

Managed applications (common-staff, personal-staff) with `autoInstall: true` are only installed when a workspace is created. Workspaces created before a new managed app was added have no way to get it installed except by running a manual backfill script.

## Design

### Trigger Point

In `InstalledApplicationsService`, add an `ensureAutoInstallApps(tenantId, installedBy)` method. Call it from the `GET /v1/installed-applications/with-bots` controller endpoint before fetching the app list.

### Anti-Reentrancy: Redis Distributed Lock

Use `SET key NX EX 30` to prevent concurrent installations for the same tenant across multiple Gateway instances:

1. Attempt to acquire lock: `SET app-backfill:{tenantId} 1 NX EX 30`
2. If lock not acquired → skip (another instance is handling it)
3. If lock acquired → check for missing auto-install apps → install each → release lock via `DEL`
4. `try/finally` ensures lock is always released
5. TTL of 30s acts as safety net if the process crashes

### Backfill Logic

1. Get all `autoInstall: true` app definitions from `ApplicationsService.findAutoInstall()`
2. Query installed apps for the tenant
3. Compute missing = autoInstall apps not yet installed
4. If no missing apps → release lock and return early
5. For each missing app → call `this.install(tenantId, installedBy, { applicationId })`
6. Log warn on per-app failure, do not block the request

### Injection

`InstalledApplicationsService` currently does not have `RedisService`. It needs to be injected via constructor.

## Files Modified

- `apps/server/apps/gateway/src/applications/installed-applications.service.ts` — add `ensureAutoInstallApps()` + inject `RedisService`
- `apps/server/apps/gateway/src/applications/installed-applications.controller.ts` — call `ensureAutoInstallApps()` in `findAllWithBots`

## Out of Scope

- Frontend changes
- Startup-time full-tenant backfill
- Personal staff bot creation for new members (handled by existing member lifecycle)
