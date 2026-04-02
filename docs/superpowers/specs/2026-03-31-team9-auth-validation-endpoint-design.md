# Team9 Auth Validation Endpoint Design

## Summary

Migrate `capability-hub` away from the OpenClaw Hive control-plane `AUTH_VALIDATION_URL` contract and make Team9 gateway the single authority for bot-token validation.

The new Team9 endpoint validates `t9bot_*` tokens, returns Team9-native subject context, and uses Redis-backed short-lived caching to reduce repeated database lookups and bcrypt comparisons.

## Problem

`capability-hub` currently validates incoming bearer tokens by calling an external URL configured through `AUTH_VALIDATION_URL`.

That validation endpoint currently points at OpenClaw Hive control-plane:

- request: `POST /api/instances/verify-proxy-gateway-token`
- body: `{ "token": "..." }`
- success response: `{ "instance_id": "..." }`

This contract is no longer a good fit for Team9:

- Team9 auth subjects are bot tokens, not OpenClaw instances
- `instance_id` is not a stable or universal Team9 concept
- only some bots are OpenClaw-backed
- Team9 already owns the authoritative bot-token store and validation logic

The migration should move validation into Team9 itself and avoid introducing unnecessary per-request load.

## Goals

- Add a Team9-owned HTTP validation endpoint for `capability-hub`
- Return Team9-native identity context: `botId`, `userId`, `tenantId`
- Keep Team9 as the only source of truth for bot-token validity
- Reduce repeated validation cost with Redis caching
- Support explicit cache invalidation on token rotation, revocation, bot deactivation, and uninstall flows

## Non-Goals

- Do not redesign Team9 bot tokens into JWTs
- Do not keep `instance_id` as part of the new contract
- Do not add cross-service distributed auth beyond this narrow validation use case
- Do not make user JWTs valid for this endpoint in V1

## Existing Context

### Team9 bot-token model

Team9 bot tokens are generated in `BotService.generateAccessToken()` and stored in `im_bots.access_token` as:

- raw token format: `t9bot_<96 hex chars>`
- persisted format: `{fingerprint}:{bcryptHash}`

Validation today happens in `BotService.validateAccessToken()`:

1. reject non-`t9bot_` tokens
2. derive `fingerprint` from the raw token
3. query active bots by `access_token LIKE '<fingerprint>:%'`
4. run bcrypt compare against matching candidates

This is already the canonical validation path. The new endpoint should wrap this logic rather than replacing it.

### Capability Hub expectations

`capability-hub` currently calls `AUTH_VALIDATION_URL` and only needs a yes/no answer plus a subject identity to attach to `request.user`.

It does not semantically depend on OpenClaw instance identity. The old `instance_id` field is an implementation artifact of the previous control-plane integration.

## Decision

Introduce a new Team9 internal endpoint:

- `POST /api/v1/internal/auth/validate-bot-token`

Request body:

```json
{
  "token": "t9bot_..."
}
```

Successful response:

```json
{
  "valid": true,
  "botId": "bot_uuid",
  "userId": "im_user_uuid",
  "tenantId": "tenant_uuid"
}
```

Failed response:

```json
{
  "valid": false,
  "error": "invalid token"
}
```

The endpoint is service-to-service only and is protected by a shared bearer secret so arbitrary callers cannot use Team9 as a token introspection oracle.

## API Contract

### Endpoint

- Method: `POST`
- Path: `/api/v1/internal/auth/validate-bot-token`
- Auth: `Authorization: Bearer <AUTH_API_KEY>`

### Request

```json
{
  "token": "t9bot_0123..."
}
```

Validation rules:

- request body must be JSON
- `token` is required
- token must start with `t9bot_`

### Success response

```json
{
  "valid": true,
  "botId": "b5c0d9d3-....",
  "userId": "3a58e16d-....",
  "tenantId": "8b71a1d4-...."
}
```

### Failure responses

- `400` malformed JSON or missing `token`
- `401` missing/invalid service authorization
- `404` token invalid, bot inactive, or tenant context cannot be resolved

Response body for invalid token:

```json
{
  "valid": false,
  "error": "invalid token"
}
```

The endpoint should not leak whether the failure came from a bad token, inactive bot, or broken mapping.

## Identity Resolution

The endpoint returns:

- `botId`: `im_bots.id`
- `userId`: `im_bots.user_id`
- `tenantId`: resolved from the bot's installed application ownership

Primary resolution path:

1. validate the bot token against `im_bots`
2. read the matched bot row
3. join `installed_application_id -> installed_applications.id`
4. return `installed_applications.tenant_id`

V1 requires `tenantId` to be present. If a token resolves to a bot without tenant context, the endpoint returns invalid.

This keeps the contract strict and avoids handing `capability-hub` an ambiguous subject.

## Cache Design

### Why cache

Repeated validation of the same token causes:

- repeated indexed DB lookups
- repeated bcrypt comparisons

For a service-to-service validation endpoint, repeated calls against the same bot token are expected. A short-lived cache can remove most of that repeated cost.

### Redis key strategy

Do not store raw tokens in Redis keys or values.

Use:

- token digest: `sha256(rawToken)`
- cache key: `auth:bot-token:<sha256>`

Cached success value:

```json
{
  "botId": "bot_uuid",
  "userId": "user_uuid",
  "tenantId": "tenant_uuid"
}
```

Cached failure value:

```json
{
  "invalid": true
}
```

### TTLs

- positive cache TTL: `30s`
- negative cache TTL: `5s`

These values are intentionally short:

- short enough to bound stale auth after revocation
- long enough to absorb bursts and repeated polling

### Singleflight

Use the existing `RedisService.getOrSet()` helper for read-through caching so concurrent requests for the same token digest coalesce into a single DB validation path.

### Reverse index for invalidation

Maintain a reverse index per bot:

- key: `auth:bot-token-keys:<botId>`
- type: Redis set
- members: cache keys created for that bot

On successful validation:

1. write `auth:bot-token:<sha256>`
2. add that cache key to `auth:bot-token-keys:<botId>`
3. set the reverse-index TTL to at least the positive TTL

This avoids needing the raw token later to invalidate token-derived cache entries.

## Cache Invalidation

### Required invalidation triggers

Invalidate auth cache entries when any of these happen:

- bot token rotation
- bot token revocation
- bot `isActive` changes from true to false
- installed application uninstall removes the bot

### Invalidation behavior

Given `botId`:

1. load members from `auth:bot-token-keys:<botId>`
2. delete all referenced `auth:bot-token:<sha256>` keys
3. delete `auth:bot-token-keys:<botId>`

If the reverse-index key is missing, the system falls back to TTL expiry.

### Why not Bloom filter

V1 should not use a Bloom filter for negative lookup optimization.

Reasons:

- current validation already narrows candidates by token fingerprint
- the main real-world hotspot is repeated validation of the same token, which short negative caching already solves
- Bloom filters complicate deletion and introduce false positives
- Team9 needs precise invalidation semantics for rotated/revoked bot tokens

If further optimization is needed later, a better V2 is a precise Redis set of active token fingerprints, not a Bloom filter.

## Team9 Implementation Shape

### New internal auth module surface

Add a small internal auth-validation surface in gateway rather than extending user login APIs.

Suggested pieces:

- controller for `/internal/auth/validate-bot-token`
- DTO for request body
- guard for service-level bearer secret
- service method returning `{ valid, botId?, userId?, tenantId?, error? }`

### Bot service extension

Extend the bot-token validation path to optionally return richer context:

- `botId`
- `userId`
- `tenantId`

This should be implemented as a dedicated method rather than overloading existing human-auth payloads.

Suggested shape:

```ts
validateAccessTokenWithContext(rawToken: string): Promise<{
  botId: string;
  userId: string;
  tenantId: string;
} | null>
```

The existing `validateAccessToken()` method can either:

- remain as a thin compatibility wrapper over the richer method, or
- keep its current signature and call into a shared internal helper

## Capability Hub Migration

Update `capability-hub` to consume the new Team9 response contract.

Current behavior:

- expects `{ instance_id }`
- maps that value to `request.user.id`

New behavior:

- expects `{ valid, botId, userId, tenantId }`
- rejects when `valid !== true`
- attaches these fields to `request.user`

Suggested request user shape:

```ts
{
  id: (userId, botId, userId, tenantId);
}
```

`id` should point to `userId` because that best matches the existing guard behavior where `request.user.id` means the authenticated subject's application-facing user ID.

## Security

### Service authorization

The validation endpoint must not be publicly callable without a second secret.

Use a dedicated shared secret, separate from user auth and separate from the OpenClaw control-plane secret.

Suggested env names:

- Team9: `INTERNAL_AUTH_VALIDATION_TOKEN`
- capability-hub: keep existing `AUTH_API_KEY`

`capability-hub` sends:

```http
Authorization: Bearer <AUTH_API_KEY>
```

Team9 compares that secret against `INTERNAL_AUTH_VALIDATION_TOKEN`.

### Response minimization

Only return the minimum identity context needed by `capability-hub`.

Do not return:

- email
- username
- installed application config
- bot capabilities

## Observability

Add lightweight logs and counters:

- validation cache hit
- validation cache miss
- validation negative-cache hit
- validation DB success
- validation DB failure

Do not log raw tokens. If logging correlation is needed, log only the first 8-12 characters of the SHA-256 digest.

## Testing

### Team9 tests

Add tests for:

- valid token returns `valid=true` with `botId/userId/tenantId`
- missing token returns `400`
- invalid service secret returns `401`
- invalid token returns `404` with `valid=false`
- inactive bot returns invalid
- cache hit avoids DB validation path
- negative cache hit avoids DB validation path
- rotate/revoke invalidates cached entries

### Capability Hub tests

Add tests for:

- new response contract parsing
- `valid=false` rejection
- `request.user` population with `id/userId/botId/tenantId`
- upstream `401/404/500` handling

## Rollout Plan

1. Add Team9 validation endpoint behind env-configured service secret
2. Add Redis-backed positive/negative caching and reverse-index invalidation
3. Update `capability-hub` to consume the new response contract
4. Switch `AUTH_VALIDATION_URL` to Team9 gateway
5. Remove any remaining dependency on OpenClaw control-plane validation for this flow

## Open Questions

None for V1. The contract and cache strategy are intentionally narrow:

- Team9 is the sole validator
- the endpoint returns only `botId`, `userId`, and `tenantId`
- short-lived Redis caching handles repeated validation cost
