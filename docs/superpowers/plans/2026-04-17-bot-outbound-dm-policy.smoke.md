# Bot Outbound DM Policy — Smoke Test Script

Manual smoke against a running gateway. Run once after the last code commit on `feat/send-to-user-api` is deployed to a dev environment.

## Prerequisites

Set these environment variables before running the `curl` snippets:

```bash
export GATEWAY_URL="http://localhost:4000"  # or your dev gateway
export BOT_TOKEN="t9bot_..."                 # a real bot access token (personal-staff by default = owner-only DM)
export OWNER_UUID="..."                      # the owner of BOT_TOKEN (so owner-only policy will allow)
export OTHER_UUID="..."                      # any other user in the SAME tenant (for rejection test)
export CROSS_TENANT_UUID="..."               # a user in a DIFFERENT tenant (for CROSS_TENANT test)
```

Grab `BOT_TOKEN` + `OWNER_UUID` from your dev DB:

```sql
SELECT b.access_token, b.owner_id, u.username
FROM im_bots b
JOIN im_users u ON u.id = b.owner_id
WHERE b.extra->>'personalStaff' IS NOT NULL
LIMIT 5;
```

---

## 1. Happy path — `POST /v1/im/bot/send-to-user` to owner

```bash
curl -sS -X POST "$GATEWAY_URL/api/v1/im/bot/send-to-user" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$OWNER_UUID\",\"content\":\"smoke: hello owner from bot $(date -u +%H:%M:%S)\"}"
```

**Expect:** HTTP 201 + body `{"channelId":"...","messageId":"..."}`.

**Visual check:** open the client as `$OWNER_UUID` — the DM from the bot should appear in the sidebar with the test message.

---

## 2. Policy refusal — same bot, non-owner target

With a personal-staff bot at default `owner-only`:

```bash
curl -sS -i -X POST "$GATEWAY_URL/api/v1/im/bot/send-to-user" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$OTHER_UUID\",\"content\":\"smoke: should be rejected\"}"
```

**Expect:** HTTP 403 with `DM_NOT_ALLOWED` in the body.

---

## 3. CROSS_TENANT rejection

```bash
curl -sS -i -X POST "$GATEWAY_URL/api/v1/im/bot/send-to-user" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$CROSS_TENANT_UUID\",\"content\":\"smoke: cross-tenant\"}"
```

**Expect:** HTTP 400 with `CROSS_TENANT` in the body.

---

## 4. USER_NOT_FOUND

```bash
curl -sS -i -X POST "$GATEWAY_URL/api/v1/im/bot/send-to-user" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"00000000-0000-0000-0000-000000000000","content":"nobody"}'
```

**Expect:** HTTP 404 with `USER_NOT_FOUND`.

---

## 5. SELF_DM

Get the bot's own userId:

```sql
SELECT user_id FROM im_bots WHERE access_token LIKE 't9bot_%' LIMIT 5;
```

Export as `BOT_USER_ID` and try:

```bash
curl -sS -i -X POST "$GATEWAY_URL/api/v1/im/bot/send-to-user" \
  -H "Authorization: Bearer $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$BOT_USER_ID\",\"content\":\"self\"}"
```

**Expect:** HTTP 400 with `SELF_DM`.

---

## 6. Missing token → 401

```bash
curl -sS -i -X POST "$GATEWAY_URL/api/v1/im/bot/send-to-user" \
  -H "Content-Type: application/json" \
  -d "{\"userId\":\"$OWNER_UUID\",\"content\":\"no auth\"}"
```

**Expect:** HTTP 401.

---

## 7. `GET /v1/im/bot/users/search` — happy path + PII stripped

```bash
curl -sS "$GATEWAY_URL/api/v1/im/bot/users/search?q=$(python3 -c 'import urllib.parse; print(urllib.parse.quote("admin"))')&limit=3" \
  -H "Authorization: Bearer $BOT_TOKEN" | python3 -m json.tool
```

**Expect:**

- HTTP 200
- Body shape `{"results": [{"userId": "...", "displayName": "..."}]}`
- **No `email`, `username`, `status`, `isActive`, `createdAt`** fields on any result.
- `avatarUrl` may or may not be present depending on search-provider output.

---

## 8. `users/search` — bot users excluded

Query something that should match a bot's displayName (e.g. a system bot name):

```bash
curl -sS "$GATEWAY_URL/api/v1/im/bot/users/search?q=assistant&limit=10" \
  -H "Authorization: Bearer $BOT_TOKEN" | python3 -m json.tool
```

**Expect:** no bot users in the `results` array. Cross-check by querying the DB directly:

```sql
SELECT u.id, u.display_name FROM im_users u
JOIN im_bots b ON b.user_id = u.id
WHERE u.display_name ILIKE '%assistant%';
```

Any id from that query should NOT appear in the endpoint response.

---

## 9. `users/search` — invalid inputs

```bash
# q too short
curl -sS -i "$GATEWAY_URL/api/v1/im/bot/users/search?q=a" -H "Authorization: Bearer $BOT_TOKEN"
# Expect HTTP 400

# limit too large
curl -sS -i "$GATEWAY_URL/api/v1/im/bot/users/search?q=abc&limit=50" -H "Authorization: Bearer $BOT_TOKEN"
# Expect HTTP 400
```

---

## 10. UI smoke — policy toggle + pino log

1. Log in to the client as the mentor/owner of the personal-staff bot used above.
2. Open the AI Staff settings for that bot.
3. Scroll below the existing visibility toggles — you should see a new **Outbound DM** radio group with 4 options.
4. Switch from _Only me_ to _Anyone in this workspace_.
5. Tail the gateway stdout — you should see one log line like:
   ```json
   {
     "event": "bot_dm_outbound_policy_changed",
     "botId": "...",
     "from": { "mode": "owner-only" },
     "to": { "mode": "same-tenant" },
     "actorUserId": "...",
     "timestamp": "..."
   }
   ```
6. Verify in DB:
   ```sql
   SELECT id, extra->'dmOutboundPolicy' FROM im_bots WHERE id = '<bot-id>';
   ```
   Expect: `{"mode": "same-tenant"}`.
7. Switch to _Specific people…_, pick 2–3 users in the picker, save → re-run the SQL query → expect `{"mode":"whitelist","userIds":[...]}`.
8. Toggle **no-op** (same policy again) — no new pino log line should appear.

---

## 11. UI smoke — common-staff variant

Repeat step 10 on a common-staff bot. Confirm:

- _Only me_ option is **not** rendered.
- Default radio selection is _Anyone in this workspace_.

---

## Rollback note

The feature is additive. If any smoke step regresses the system:

- Gateway rollback: `git revert` the range `0918e6a3..c5cccb86`.
- Client rollback: `git revert` the range `8a8ad836..bb071058`.
- DB has no migrations — `extra.dmOutboundPolicy` is jsonb-level only; no rollback needed.
