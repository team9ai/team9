# Hidden Application Flag — Design

**Date:** 2026-04-16
**Status:** Approved, ready for implementation
**Author:** Team9

## Background

The `applications` module defines a hardcoded list of installable applications
(`openclaw`, `base-model-staff`, `common-staff`, `personal-staff`). Applications
with `type: 'custom'` appear in the "Available Apps" section of the app browser
([ApplicationMainContent.tsx](../../../apps/client/src/components/layout/contents/ApplicationMainContent.tsx))
where any workspace member can install them via `POST /v1/installed-applications`.

We want to soft-retire the public `openclaw` entry: new workspaces should no
longer be able to self-install OpenClaw, but workspaces that have already
installed it must keep working without disruption (they can continue using it
and may uninstall, just not reinstall).

This should be a reusable mechanism, not a one-off, so that future
deprecations/soft-retirements can be handled by flipping a single flag.

## Goal

Introduce a `hidden` flag on the `Application` definition. When set:

1. The app does not appear in `GET /v1/applications` for tenants that have not
   installed it.
2. `GET /v1/applications/:id` returns `404` for the same group of tenants (to
   avoid leaking the existence of deprecated apps).
3. New installations are rejected with `403 Forbidden`.
4. Auto-install / backfill logic skips the app.
5. Tenants that have already installed the app see no behavior change — list
   reads, status queries, bot operations, uninstall all continue to work.

Mark `openclaw` as `hidden: true`.

## Non-goals

- Soft-hiding at the user level (per-user visibility). Installation is a
  workspace/tenant concept; this spec keeps that scope.
- An admin-facing toggle/UI to flip `hidden` at runtime. The flag is code-level
  configuration.
- Client-side changes. The frontend already renders `allApps − installed`, so
  server-side filtering is sufficient.
- Data migrations. Existing `installed_applications` rows are untouched.

## Design

### Type change

[apps/server/apps/gateway/src/applications/application.types.ts](../../../apps/server/apps/gateway/src/applications/application.types.ts)

Add optional `hidden?: boolean` to the `Application` interface. Undefined is
treated the same as `false`.

### `ApplicationsService`

[apps/server/apps/gateway/src/applications/applications.service.ts](../../../apps/server/apps/gateway/src/applications/applications.service.ts)

- **`findAll()`** — unchanged behavior (returns every enabled app). Kept as the
  internal/unfiltered accessor used by handlers and tests.
- **`findAllVisible(installedIds: Set<string>): Application[]`** — new method.
  Returns `findAll()` filtered to exclude entries where `hidden === true` and
  `!installedIds.has(entry.id)`.
- **`findById(id)`** — unchanged; must still return hidden apps because the
  install handler, uninstall handler, and `InstalledApplicationsService.omitSecrets`
  all depend on it for definition metadata.
- **`findAutoInstall()`** — filter out hidden entries. Prevents the logical
  contradiction of a hidden+autoInstall app and keeps backfill paths clean.

### `ApplicationsController`

[apps/server/apps/gateway/src/applications/applications.controller.ts](../../../apps/server/apps/gateway/src/applications/applications.controller.ts)

- **`GET /v1/applications`** — inject `InstalledApplicationsService`, resolve the
  current tenantId (same source as other tenant-scoped endpoints in this module,
  typically via an auth/tenant decorator), call `findAllByTenant(tenantId)` to
  build the installed-id set, then return `applicationsService.findAllVisible(installedIds)`.
- **`GET /v1/applications/:id`** — after `findById(id)`, if the app is `hidden`
  and the current tenant has no matching `installed_applications` row, throw
  `NotFoundException`. Existing 404 for unknown ids stays the same.

### `InstalledApplicationsService.install`

[apps/server/apps/gateway/src/applications/installed-applications.service.ts](../../../apps/server/apps/gateway/src/applications/installed-applications.service.ts) (around line 183)

Add a guard **before** the existing singleton check and handler registration:

```
const appDefinition = this.applicationsService.findById(dto.applicationId);
if (appDefinition?.hidden) {
  throw new ForbiddenException(
    `Application ${appDefinition.name} is no longer available for new installation`,
  );
}
```

This guard sits on the install critical path, so it covers every caller —
direct API, backfill, auto-install, admin tooling. It is additive to the
existing `findAutoInstall()` filter; defense in depth.

Uninstall path is intentionally unchanged. Hidden apps remain uninstallable via
the same endpoint as before (subject to the existing managed-app guard).

### OpenClaw marker

In the `APPLICATIONS` array inside `applications.service.ts`, set `hidden: true`
on the `openclaw` entry.

## Behavior matrix

| Tenant state           | `GET /applications` includes openclaw? | `GET /applications/openclaw` | `POST /installed-applications {id: openclaw}` |
| ---------------------- | -------------------------------------- | ---------------------------- | --------------------------------------------- |
| Not installed          | No                                     | 404                          | 403 Forbidden                                 |
| Installed              | Yes                                    | 200 (definition)             | 409 Conflict (existing singleton)             |
| Previously uninstalled | No                                     | 404                          | 403 Forbidden                                 |

Note: for an installed tenant, the server still returns openclaw in
`GET /applications`. The "Available Apps" section in the UI does not render
it because [ApplicationMainContent.tsx](../../../apps/client/src/components/layout/contents/ApplicationMainContent.tsx)
subtracts installed apps from the full list. Keeping openclaw in the server
response for installed tenants preserves list semantics for any other client
that renders the catalog differently.

## Testing

### Unit

**`applications.service.spec.ts`**

- `findAllVisible` returns hidden apps when present in `installedIds`.
- `findAllVisible` excludes hidden apps when absent from `installedIds`.
- `findAllVisible` always includes non-hidden apps regardless of install state.
- `findAutoInstall` excludes hidden entries even when `autoInstall: true`.
- `findById` still returns hidden apps (regression guard for the install/uninstall
  metadata path).

**`installed-applications.service.spec.ts`**

- `install` with a hidden applicationId throws `ForbiddenException`; the
  forbidden path happens before any DB write (no row inserted).
- `install` with a non-hidden applicationId is unaffected.
- `uninstall` of an already-installed hidden app succeeds (handler's
  `onUninstall` still invoked, row deleted).
- `findAllByTenant` / `findByApplicationId` still resolve hidden apps correctly
  (metadata enrichment via `omitSecrets`).

### Controller

**`applications.controller.spec.ts`**

- `GET /applications` returns openclaw when installed-ids include it; omits it
  when they don't.
- `GET /applications/openclaw` returns 404 when not installed by the tenant.
- `GET /applications/openclaw` returns 200 when installed.
- `GET /applications/:id` 404 for unknown id unchanged.

### Integration / regression

Existing specs that exercise OpenClaw install flows
(`installed-applications.controller.spec.ts`, any handler specs) should be
reviewed and, where they assert the app appears in the `/applications` list
for a fresh tenant, updated to reflect the new behavior or pivoted to an
`installedIds`-containing fixture.

## Risks & considerations

- **Silent deprecation vs. explicit messaging.** A 404 on `GET /:id` prevents
  leaking the existence of a deprecated app but also means existing clients
  won't get a clear "this app was retired" signal. Acceptable: nobody besides
  already-installed tenants should care.
- **Tenant resolution in controller.** `ApplicationsController` currently does
  not read tenant context. It already guards with `AuthGuard`. The tenant id
  must be pulled the same way sibling controllers do (inspect
  `installed-applications.controller.ts` for the exact decorator/source before
  implementation).
- **`findAllVisible` vs. a flag argument.** A single mutated `findAll` would be
  simpler, but the handler/module layer still needs unfiltered access. Keeping
  them as two methods avoids accidental over-filtering.
- **Backfill safety.** `findAutoInstall()` is the only caller that cares about
  auto-install at module init and on tenant creation. Filtering hidden there
  means a future `hidden + autoInstall` configuration is safely ignored. The
  install-path guard is the backstop.
