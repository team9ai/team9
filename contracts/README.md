# Vendored ahand contracts

JSON Schemas mirroring the canonical copies in the `aHand` repo at
[`contracts/`](https://github.com/team9ai/aHand/tree/dev/contracts).

These files are vendored — when the upstream changes, refresh them with:

```bash
cp ../aHand/contracts/hub-webhook.json contracts/
cp ../aHand/contracts/hub-control-plane.json contracts/
```

(Adjust the `aHand` path to wherever the sibling checkout lives — see
`CLAUDE.local.md` for typical paths.)

## Why vendored, not git-submoduled

The schemas change rarely (a few times per quarter at most) and downstream
consumers — the gateway contract test, the k6 load baseline payload
generator — must work in a CI checkout that already cloned this repo. A
git submodule would force every clone to also pull `aHand` (a large Rust

- Tauri tree) just to read two JSON files. Vendoring keeps the test
  self-contained and the schemas reviewable in PR diffs.

## What pins the freshness

The contract test (`apps/server/apps/gateway/test/ahand-contract.e2e-spec.ts`)
is the freshness gate. If a hub-side schema change goes out, the test
fails when the gateway DTO drifts from the schema. The `aHand`-side CI
is where the schema is owned; team9-side CI just enforces alignment.

## Last sync

`hub-webhook.json` and `hub-control-plane.json` last synced from `aHand` dev @ `a21d9a44107d30ce6765e13f58a735759bc428ab` (with the Phase 9 / Task 9.5 schemas authored in `feat/ahand-contract-schemas` on top — see that branch for the canonical source).
