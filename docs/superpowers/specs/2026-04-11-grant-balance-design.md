# Grant Balance: Separate Credit Pool for Gifted Credits

**Date:** 2026-04-11
**Status:** Draft
**Projects:** billing-hub, team9

## Problem

We want to give new registered users 4000 free credits. These gifted credits should be tracked separately from paid credits (recharge balance) and consumed with higher priority. Currently billing-hub has a single `balance` field that mixes paid and gifted credits together.

## Solution

Add a `grant_balance` column to the billing-hub `accounts` table. This creates two permanent credit pools:

- **grant_balance** — gifted credits (from `grant` operations)
- **balance** — paid credits (from `recharge`, `refund`, `admin_adjust`)

Both are permanent (no expiration). The deduction priority becomes:

```
Quota → Grant Balance → Balance → Credit Limit
```

## Design Decisions

| Decision                | Choice                            | Rationale                                                                     |
| ----------------------- | --------------------------------- | ----------------------------------------------------------------------------- |
| Refund target           | balance only                      | Grant credits are free; no reason to refund gifted credits                    |
| admin_adjust            | Both pools via `target` param     | Superadmin needs flexibility; default is `balance` for backward compat        |
| Frontend display        | Combined total + detail breakdown | Main view shows total available; billing detail page shows per-pool breakdown |
| Signup bonus amount     | Hardcoded 4000                    | Simple; change code when needed                                               |
| Grant failure on signup | Soft-fail (log + continue)        | Registration must not be blocked by billing failures                          |

---

## Part 1: Data Model

### Schema Change

```sql
ALTER TABLE accounts ADD COLUMN grant_balance bigint NOT NULL DEFAULT 0;
```

Drizzle schema addition in `accounts.ts`:

```typescript
grantBalance: bigint('grant_balance', { mode: 'bigint' }).notNull().default(sql`0`),
```

### Balance Formula

```
effectiveQuota = (quotaExpiresAt > now) ? quota : 0
available = effectiveQuota + grantBalance + balance + creditLimit
```

### Deduction Logic (SQL CTE pseudocode)

```sql
quotaUsed      = LEAST(effectiveQuota, amount)
remaining1     = amount - quotaUsed
grantUsed      = LEAST(grantBalance, remaining1)
balanceUsed    = remaining1 - grantUsed

-- Sufficiency check
WHERE effectiveQuota + grantBalance + balance + creditLimit >= amount

-- Updates
SET quota         = quotaAfter,
    grant_balance = grantBalance - grantUsed,
    balance       = balance - balanceUsed
```

### Operation Effects on Pools

| Operation                               | grant_balance |   balance    | Notes                                                     |
| --------------------------------------- | :-----------: | :----------: | --------------------------------------------------------- |
| **grant**                               |    +amount    |      —       | Gifted credits go to grant_balance                        |
| **recharge**                            |       —       |   +amount    | Paid credits go to balance                                |
| **deduct/consume**                      |  −grantUsed   | −balanceUsed | Priority: quota → grant → balance → credit limit          |
| **refund**                              |       —       |   +amount    | Refunds only go to balance                                |
| **admin_adjust (target=balance)**       |       —       |   ±amount    | Default behavior, backward compatible                     |
| **admin_adjust (target=grant_balance)** |    ±amount    |      —       | Explicit target required; grant_balance cannot go below 0 |
| **recharge_reversal**                   |       —       |   −amount    | Only reverses balance                                     |
| **quota_grant/reset/reversal**          |       —       |      —       | Only affects quota                                        |

---

## Part 2: Redis Lua Script & Cache

### Redis Hash New Field

Account hash `billing:ledger:account:{accountId}` adds:

```
grantBalance: string   -- bigint string representation, initialized to "0"
```

### Lua Deduct Logic Change

Before:

```lua
quotaUsed = min(effectiveQuota, amount)
balanceUsed = amount - quotaUsed
balanceAfter = balance - balanceUsed
```

After:

```lua
quotaUsed = min(effectiveQuota, amount)
local remaining = amount - quotaUsed
grantUsed = min(grantBalance, remaining)
balanceUsed = remaining - grantUsed
grantBalanceAfter = grantBalance - grantUsed
balanceAfter = balance - balanceUsed
```

Available calculation:

```lua
availableBefore = effectiveQuota + grantBalance + balance + creditLimit
availableAfter  = effectiveQuotaAfter + grantBalanceAfter + balanceAfter + creditLimit
```

### Lua Grant Logic Change

Before: `balance += amount`
After: `grantBalance += amount`

### Lua Admin Adjust Change

New `target` parameter. When `target == 'grant_balance'`:

```lua
if target == 'grant_balance' then
  if signedAmount < 0 and abs(signedAmount) > grantBalance then
    return error('INSUFFICIENT_GRANT_BALANCE')  -- 400
  end
  grantBalanceAfter = grantBalance + signedAmount
  balanceAfter = balance  -- unchanged
end
```

Default (`target == 'balance'`): existing behavior unchanged. `grant_balance` cannot go below 0.

### Event Payload New Fields

```
grantBalanceBefore: string
grantBalanceAfter: string
grantUsed: string | null     -- only for consume operations
```

### Redis-to-DB Sync

The sync worker drains events from Redis streams and persists them to PostgreSQL. It must:

1. When creating the transaction record: store `grantBalanceBefore`, `grantBalanceAfter`, `grantUsed` in `metadata._billing`
2. When updating the account row: set `grant_balance = grantBalanceAfter` from the event payload
3. When loading an account from DB into Redis (cache miss / cold start): read `grant_balance` column and populate the hash field

### Balance Cache

`billing:balance:{accountId}` adds `grantBalance: string` field.

---

## Part 3: API Changes

### Integration API

**GET /api/billing/account** — response adds:

```json
{ "grantBalance": 4000 }
```

**POST /api/billing/grant** — no request change; internally writes grant_balance instead of balance.

All mutation responses (`BillingMutationResult`) uniformly add `grantBalanceAfter`. The `grantUsed` field is only present in deduct/consume responses.

**POST /api/billing/deduct** — response adds:

```json
{ "grantUsed": 100, "grantBalanceAfter": 3900 }
```

**POST /api/billing/refund** — response adds `grantBalanceAfter` (unchanged value, no `grantUsed`).

**POST /api/billing/recharge** — response adds `grantBalanceAfter` (unchanged value, no `grantUsed`).

**POST /api/billing/usage** — response adds `grantUsed`, `grantBalanceAfter` (passes through from deduct).

### Admin API

**POST /admin/adjust** — request adds optional parameter:

```json
{ "target": "balance" | "grant_balance" }
```

Default: `"balance"`. Backward compatible.

**GET /admin/stats** — adds `totalGrantBalance` to dashboard stats.

### Billing Metadata Snapshot

Transaction `metadata._billing` adds:

```json
{
  "grantBalanceBefore": 4000,
  "grantBalanceAfter": 3900,
  "grantUsed": 100
}
```

### Team9 Gateway Changes

**BillingHubService** — new method:

```typescript
async grantCredits(
  workspaceId: string,
  amount: number,
  referenceType: string,
  referenceId: string,
  description?: string,
): Promise<void>
```

**WorkspaceService** — in `provisionStarterWorkspaceForRegisteredUser()`, after workspace creation:

```typescript
try {
  await this.billingHubService.grantCredits(
    workspace.id,
    4000,
    "signup_bonus",
    `signup:${event.userId}`,
    "New user welcome bonus",
  );
} catch (error) {
  this.logger.error(
    `Failed to grant signup bonus for user ${event.userId}: ${error.message}`,
  );
}
```

### Team9 Frontend Changes

**Billing Overview page:**

- Main area: total available balance (existing)
- Detail section: show "Gifted Credits" / "Paid Credits" / "Subscription Quota" separately

**Billing Hub Admin Panel:**

- Account detail page: display grantBalance
- Admin adjust action: dropdown to select target → "Paid Balance" / "Gifted Balance"
- Transaction records: show grantUsed in metadata display (when present)

---

## Part 4: Test Plan

### Test Helpers

**`test/helpers/fixtures.ts`** — `createTestAccount` supports `grantBalance` override (default: 0).

### New Integration Tests: `test/integration/grant-balance.spec.ts`

| #   | Scenario                                            | Verification                                                                |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | grant writes grant_balance                          | grantBalance increases, balance unchanged                                   |
| 2   | deduct prioritizes grant_balance                    | grantBalance deducted first, balance untouched                              |
| 3   | deduct cross-pool: grant_balance insufficient       | grantUsed = grantBalance, remaining from balance                            |
| 4   | deduct three pools: quota + grant + balance         | quotaUsed + grantUsed + balanceUsed = amount                                |
| 5   | deduct with grantBalance=0 (regression)             | Behaves identically to pre-change logic                                     |
| 6   | deduct insufficient total returns 402               | effectiveQuota + grantBalance + balance + creditLimit < amount              |
| 7   | deduct exactly equals grantBalance (boundary)       | grantUsed = grantBalance, balanceUsed = 0                                   |
| 8   | deduct with expired quota + grantBalance            | Skips quota, deducts from grantBalance                                      |
| 9   | deduct with credit limit fallback                   | grantBalance=100, balance=100, creditLimit=200, deduct 350                  |
| 10  | recharge only affects balance                       | grantBalance unchanged after recharge                                       |
| 11  | refund only affects balance                         | grantBalance unchanged after refund                                         |
| 12  | grant idempotency                                   | Same referenceType+referenceId does not double-grant                        |
| 13  | grant auto-creates account                          | Non-existent account created with correct grantBalance                      |
| 14  | multiple grants accumulate                          | Two grants → grantBalance = sum                                             |
| 15  | API response includes grantBalance                  | GET /account returns grantBalance field                                     |
| 16  | deduct response includes grantUsed                  | Consume returns grantUsed and grantBalanceAfter                             |
| 17  | transaction metadata snapshot                       | consume \_billing includes grantBalanceBefore, grantBalanceAfter, grantUsed |
| 18  | frozen account grant                                | grant to frozen account succeeds (matches existing grant behavior)          |
| 19  | admin_adjust negative grant_balance exceeds current | Returns 400 INSUFFICIENT_GRANT_BALANCE                                      |
| 20  | admin_adjust negative grant_balance within range    | grantBalance reduced, balance unchanged                                     |

### Modified Existing Tests

| File                            | Changes                                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| **`grant.spec.ts`**             | Verify grant writes grant_balance (not balance)                                          |
| **`deduct.spec.ts`**            | Add grantBalance=0 regression assertions; verify new response fields                     |
| **`refund.spec.ts`**            | Assert grantBalance unchanged after refund                                               |
| **`recharge.spec.ts`**          | Assert grantBalance unchanged after recharge                                             |
| **`admin-adjust.spec.ts`**      | New cases for target=grant_balance (positive/negative); default target=balance unchanged |
| **`usage.spec.ts`**             | Verify grantUsed flows through from deduct                                               |
| **`billing-reversal.spec.ts`**  | Assert grantBalance unchanged after recharge_reversal and quota_reversal                 |
| **`redis-ledger-sync.spec.ts`** | Verify grantBalance fields persist correctly in synced transactions                      |
| **`account-read.spec.ts`**      | Verify grantBalance appears in account response                                          |

### New Unit Tests

| File                                              | Content                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **`test/unit/lib/api-serializers.spec.ts`** (new) | Verify grantBalance serialization in serializeAccount and serializeBillingMutationResult |

### Test Coverage Summary

- **28 test scenarios** covering core logic, edge cases, regression, and metadata
- **Dual-path coverage**: Redis Lua fast-path and DB transaction fallback
- **9 existing test files** updated for backward compatibility assertions
- **1 new integration test file** + **1 new unit test file**

---

## File Change Summary

### Billing Hub (`/Users/jiangtao/Desktop/shenjingyuan/billing-hub`)

| File                                            | Type      | Change                                                                   |
| ----------------------------------------------- | --------- | ------------------------------------------------------------------------ |
| `server/src/db/schema/accounts.ts`              | Schema    | Add `grantBalance` column                                                |
| `server/src/db/migrations/0008_*.sql`           | Migration | ALTER TABLE ADD COLUMN                                                   |
| `server/src/services/account.service.ts`        | Service   | BalanceState, BalanceInfo, buildBalanceInfo, cache read/write            |
| `server/src/services/billing.service.ts`        | Service   | Types, grant(), deduct() CTE, adjust(), snapshots, all RETURNING clauses |
| `server/src/services/redis-ledger.service.ts`   | Service   | Lua script, account hash, event payload                                  |
| `server/src/lib/api-serializers.ts`             | Lib       | CreditFields, serializeAccount, serializeBillingMutationResult           |
| `server/src/routes/integration.ts`              | Route     | grant validation (no change needed), deduct/usage response               |
| `server/src/routes/admin.ts`                    | Route     | adjust schema add target param, stats add totalGrantBalance              |
| `server/src/services/stats.service.ts`          | Service   | Add grantBalance to balance stats                                        |
| `server/test/helpers/fixtures.ts`               | Test      | createTestAccount grantBalance support                                   |
| `server/test/integration/grant-balance.spec.ts` | Test      | New: 20 scenarios                                                        |
| `server/test/unit/lib/api-serializers.spec.ts`  | Test      | New: serializer tests                                                    |
| 9 existing test files                           | Test      | Regression and new field assertions                                      |

### Team9 (`/Users/jiangtao/Desktop/shenjingyuan/team9`)

| File                                                              | Type     | Change                                           |
| ----------------------------------------------------------------- | -------- | ------------------------------------------------ |
| `apps/server/apps/gateway/src/billing-hub/billing-hub.service.ts` | Service  | Add grantCredits() method, update response types |
| `apps/server/apps/gateway/src/workspace/workspace.service.ts`     | Service  | Call grantCredits after workspace creation       |
| `apps/client/src/routes/...billing page`                          | Frontend | Detail view showing grantBalance breakdown       |

### Billing Hub Admin Panel

| File                | Type     | Change                                    |
| ------------------- | -------- | ----------------------------------------- |
| Account detail page | Frontend | Display grantBalance                      |
| Admin adjust form   | Frontend | Target dropdown (balance / grant_balance) |
| Transaction detail  | Frontend | Show grantUsed when present               |
