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

Two gates work together:

1. **Bit-for-bit freshness** — `.github/workflows/contracts-freshness.yml` parses the **Last sync** SHA below, fetches `contracts/hub-webhook.json` + `contracts/hub-control-plane.json` from `aHand` at that SHA, and `diff`s against the vendored copies. Fails the build if either file drifts. This catches: someone editing the vendored copy directly, or someone bumping the SHA without re-vendoring (or vice versa).
2. **Behavioural freshness** — the gateway contract test (`apps/server/apps/gateway/test/contracts/hub-webhook.contract.e2e-spec.ts`) Ajv-validates canonical payloads against the vendored schema and round-trips a signed payload through the controller. Fails when the gateway DTO drifts from the schema even if the schema itself is in sync with upstream.

The `aHand`-side CI owns the schemas; the team9-side gates enforce that whatever ships in this repo matches the `aHand` SHA recorded below.

## Last sync

`hub-webhook.json` and `hub-control-plane.json` last synced from `aHand` dev @ `4b77c0ba1ed4249312080a5130bc8b20aba26230` (PR [team9ai/aHand#12](https://github.com/team9ai/aHand/pull/12)).

> **When refreshing**: bump the SHA on the line above to the new aHand commit, then re-run the `cp` commands at the top of this file. The freshness workflow parses the SHA from this exact line — keep the format `aHand` dev @ `<40-hex>`.
