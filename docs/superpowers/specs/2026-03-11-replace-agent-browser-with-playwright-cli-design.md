# Replace agent-browser with playwright-cli

## Summary

Replace the Vercel Labs `agent-browser` CLI (v0.9.1) with Microsoft's `@playwright/cli` (npm package: `@playwright/cli`, binary: `playwright-cli`, source: [github.com/microsoft/playwright-cli](https://github.com/microsoft/playwright-cli)) as the browser automation backend in aHand. This eliminates the daemon.js bridge layer, simplifies the 6-step installation to 3 steps, and keeps the aHand → OpenClaw interface unchanged.

**Target version:** `@playwright/cli@0.1.1` (pin exact version for stability; install command must also use this pinned version)

## Motivation

- `agent-browser` is a third-party binary from Vercel Labs with limited maintenance visibility
- The current architecture has unnecessary layers: CLI → IPC socket → daemon.js → Playwright → browser
- `@playwright/cli` is maintained by Microsoft (the Playwright team), has built-in session management, and a daemon architecture handled internally
- playwright-cli has a richer command set (storage, network mocking, tracing, video) for future use

## Package Verification

`@playwright/cli` is a thin wrapper over `playwright/lib/cli/client/program` (the Playwright core CLI client). The env vars use `PLAYWRIGHT_MCP_*` prefix because playwright-cli shares the configuration system with Playwright MCP — this is by design, not a naming error.

## Architecture

### Current

```
OpenClaw → aHand handler → BrowserManager → agent-browser CLI → daemon.js (IPC) → Playwright → Chrome
```

### New

```
OpenClaw → aHand handler → BrowserManager → playwright-cli → (internal daemon) → Playwright → Chrome
```

- aHand's `handle_browser_proxy()` still receives OpenClaw HTTP-format requests
- `translate_http_to_cli()` maps them to playwright-cli commands (instead of agent-browser commands)
- `BrowserManager::execute()` spawns `playwright-cli -s=<session> <command> <args>`
- Output is parsed from stdout text + exit code (instead of JSON)
- Binary outputs (screenshots, PDFs) are read from files specified via `--filename=<path>`

## Affected Repositories

1. **aHand** (`/Users/jiangtao/Desktop/shenjingyuan/aHand`) — primary changes
2. **Team9** (`/Users/jiangtao/Desktop/shenjingyuan/team9`) — setup wizard simplification
3. **OpenClaw** — no changes needed (aHand handler maintains the same interface)

---

## Detailed Changes

### 1. BrowserManager (aHand: `crates/ahandd/src/browser.rs`)

#### 1.1 Binary Path

```rust
// Old: ~/.ahand/bin/agent-browser
// New: default to ~/.ahand/node/bin/playwright-cli (installed by npm -g),
//      fallback to PATH, or explicit config binary_path
fn binary_path(&self) -> PathBuf {
    match &self.config.binary_path {
        Some(p) => PathBuf::from(p),
        None => {
            // Prefer the aHand-managed Node.js installation
            let ahand_path = dirs::home_dir()
                .unwrap_or_default()
                .join(".ahand/node/bin/playwright-cli");
            if ahand_path.exists() {
                ahand_path
            } else {
                PathBuf::from("playwright-cli") // fallback to PATH
            }
        }
    }
}
```

#### 1.2 CLI Arguments

```rust
// Old: ["--json", "--session", session_id, action, ...args]
// New: ["-s=<session_id>", command, ...args]
fn build_cli_args(&self, session_id: &str, action: &str, params_json: &str) -> Vec<String> {
    let mut args = vec![
        format!("-s={}", session_id),
        action.to_string(),
    ];
    // ... append command-specific args
    args
}
```

#### 1.3 Output Parsing

playwright-cli outputs human-readable text to stdout (no `--json` flag). The `result_json` field in `BrowserCommandResult` will now contain plain text instead of structured JSON. All consumers of this field (the `handle_browser_proxy` response builder, and the `ahand_client` BrowserResponse) must handle this — the text is passed through to the AI agent which can interpret it naturally.

```rust
// Old: parse JSON {success, data, error} from stdout
// New: text-based parsing
async fn parse_output(
    &self,
    output: &Output,
    action: &str,
    output_file: Option<&str>, // pre-determined --filename path
) -> Result<BrowserCommandResult> {
    let success = output.status.success(); // exit code 0
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    // For screenshot/pdf, read binary file from the --filename path
    // that was injected by execute() before spawning the CLI.
    let (binary_data, binary_mime) = if matches!(action, "screenshot" | "pdf") && success {
        if let Some(path) = output_file {
            self.read_file_at_path(path).await
        } else {
            (Vec::new(), String::new())
        }
    } else {
        (Vec::new(), String::new())
    };

    Ok(BrowserCommandResult {
        success,
        result_json: if success { stdout } else { String::new() },
        error: if success { String::new() } else { stderr },
        binary_data,
        binary_mime,
    })
}
```

**File path strategy for screenshot/pdf:** The `execute()` method injects `--filename=<path>` into the CLI args using a deterministic path from `downloads_dir/session_id/timestamp_action.ext`. This extends the existing `inject_default_path()` logic (currently only for download/pdf) to also cover screenshot.

#### 1.4 Environment Variables

Remove:

- `AGENT_BROWSER_HOME`
- `AGENT_BROWSER_SOCKET_DIR`
- `AGENT_BROWSER_EXECUTABLE_PATH`
- `AGENT_BROWSER_HEADED`

Add/Keep:

- `PATH` — prepend Node.js bin dir (kept as-is)
- `PLAYWRIGHT_BROWSERS_PATH` — kept (same Playwright engine underneath)
- `PLAYWRIGHT_MCP_HEADLESS` — set to `"false"` when `config.headed == true`
- `PLAYWRIGHT_MCP_EXECUTABLE_PATH` — set from `config.executable_path`

#### 1.5 Remove daemon.js references

- Delete `daemon_home()` method
- Remove daemon.js existence check from `check_prerequisites()`
- Remove socket_dir handling

#### 1.6 Fix `handle_browser_proxy` result wrapping (CRITICAL)

**File:** `crates/ahandd/src/openclaw/handler.rs`

The current handler wraps `result_json` into the OpenClaw response by JSON-parsing it:

```rust
// CURRENT (line ~514):
let result_value: serde_json::Value = if !result.result_json.is_empty() {
    serde_json::from_str(&result.result_json).unwrap_or(serde_json::Value::Null)
    // ↑ PROBLEM: playwright-cli outputs plain text, not JSON.
    //   serde_json::from_str("Page title: Hello World") → Err → falls back to Null
    //   AI agent receives { result: null } and loses all output!
} else { ... };
```

**Fix:** When JSON parsing fails, wrap the text as a JSON string value so it's preserved:

```rust
// NEW:
let result_value: serde_json::Value = if !result.result_json.is_empty() {
    serde_json::from_str(&result.result_json).unwrap_or_else(|_| {
        // playwright-cli outputs plain text; wrap as JSON string
        serde_json::Value::String(result.result_json.clone())
    })
} else if !result.error.is_empty() {
    serde_json::json!({ "error": result.error })
} else {
    serde_json::Value::Null
};
```

This ensures:

- Existing JSON output (if any) is still parsed as structured data
- Plain text output becomes a JSON string value, preserved for the AI agent
- OpenClaw `browser-tool.ts` receives `{ result: "Page title: Hello World" }` instead of `{ result: null }`

**Impact on OpenClaw `applyProxyPaths`:** The `applyProxyPaths()` function in `browser-tool.ts` accesses `result.path`, `result.imagePath`, `result.download.path` for file path remapping. When `result` is a plain string (not an object), these property accesses return `undefined` — harmless but the path remapping won't run. This is acceptable because:

- Screenshots/PDFs: file data goes through the `files[]` array with base64, not through `result.path`
- Snapshots: no file path to remap, just text content
- If specific actions need structured results in the future, the `parse_output` method can construct JSON for those actions

### 2. Command Mapping (aHand: `crates/ahandd/src/openclaw/handler.rs`)

#### 2.1 `translate_http_to_cli` changes

| OpenClaw Route             | Old CLI                 | New CLI                                                                                                                                                                |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /navigate`           | `open <url>`            | `goto <url>`                                                                                                                                                           |
| `POST /start`              | `start`                 | `open [url] --headed` (when `config.headed == true`; `open` already starts a browser so no separate start step needed)                                                 |
| `POST /stop`               | `stop`                  | `close`                                                                                                                                                                |
| `GET /tabs`                | `tabs`                  | `tab-list`                                                                                                                                                             |
| `POST /tabs/open`          | `open <url>`            | `tab-new [url]`                                                                                                                                                        |
| `DELETE /tabs/<id>`        | `close`                 | Requires two-step: first `tab-list` to find the index of the tab with matching ID, then `tab-close <index>`. Implement as helper `close_tab_by_id()` in BrowserManager |
| `POST /tabs/focus`         | `focus`                 | `tab-select <index>`                                                                                                                                                   |
| `GET /` (status)           | `status`                | `list` (shows active sessions; semantically equivalent)                                                                                                                |
| `GET /profiles`            | `profiles`              | No direct equivalent in playwright-cli (`list` shows sessions, not profiles). Return empty array `[]` if no consumer depends on this; otherwise remove the route       |
| `GET /console`             | `console`               | `console`                                                                                                                                                              |
| `GET /snapshot`            | `snapshot`              | `snapshot`                                                                                                                                                             |
| `POST /screenshot`         | `screenshot`            | `screenshot`                                                                                                                                                           |
| `POST /pdf`                | `pdf`                   | `pdf`                                                                                                                                                                  |
| `POST /download`           | `download <ref> [path]` | See §2.5 Download Implementation below                                                                                                                                 |
| `POST /wait/download`      | `download`              | See §2.5 Download Implementation below                                                                                                                                 |
| `POST /hooks/file-chooser` | `upload`                | `upload <file>`                                                                                                                                                        |
| `POST /hooks/dialog`       | `dialog`                | Check `body.accept`: if true → `dialog-accept [body.promptText]`, if false → `dialog-dismiss`                                                                          |

#### 2.2 `translate_act_kind` changes

| kind             | Old CLI               | New CLI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Notes                                                                                                               |
| ---------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `click`          | `click <ref>`         | `click <ref>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Same                                                                                                                |
| `type`           | `type <ref> <text>`   | Default: `fill <ref> <text>` (+ `press Enter` if `submit: true`). **Semantic difference:** `fill` directly sets the value (triggers `input`/`change` events), while the old `type` simulated keystrokes (triggers `keydown`/`keypress`/`keyup` per character). For cases requiring keystroke simulation (e.g., autocomplete, search-as-you-type), use two-step: `click <ref>` then `type <text>`. `fill` covers ~90% of form interactions correctly. When OpenClaw sends `submit: true`, append a separate `press Enter` command |
| `fill`           | `fill <ref> <value>`  | `fill <ref> <text>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Same                                                                                                                |
| `press`          | `press <key>`         | `press <key>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Same                                                                                                                |
| `hover`          | `hover <ref>`         | `hover <ref>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Same                                                                                                                |
| `scrollIntoView` | `scroll <ref>`        | `eval "el => el.scrollIntoView({block:'center'})" <ref>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `hover` would auto-scroll but also trigger CSS hover side-effects (tooltips, dropdowns); use `eval` for pure scroll |
| `select`         | `select <ref> <vals>` | `select <ref> <val>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Same                                                                                                                |
| `evaluate`       | `evaluate <expr>`     | `eval <func> [ref]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Command name change                                                                                                 |
| `wait` (text)    | `wait <text>`         | See §2.6 Wait Implementation below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `wait` (delay)   | `wait --timeout <ms>` | `eval "() => new Promise(r => setTimeout(r, <ms>))"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pure delay — use eval with Promise                                                                                  |
| `close`          | `close`               | `close`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Same                                                                                                                |
| `drag`           | `drag`                | `drag <startRef> <endRef>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Same                                                                                                                |
| `resize`         | `resize`              | `resize <w> <h>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Same                                                                                                                |

#### 2.3 `params_to_cli_args` changes

| action                     | Old args                                 | New args                                            |
| -------------------------- | ---------------------------------------- | --------------------------------------------------- |
| `open`/`navigate` → `goto` | `<url>` positional                       | `<url>` positional                                  |
| `screenshot`               | `[path] [--full-page]`                   | `[ref] [--filename=<path>]`                         |
| `pdf`                      | `[path] [--full-page]`                   | `[--filename=<path>]`                               |
| `snapshot`                 | `[--compact] [--depth N] [--selector S]` | `[--filename=f]`                                    |
| `fill`/`type` → `fill`     | `<selector> <value>`                     | `<ref> <text>`                                      |
| `evaluate` → `eval`        | `<expression>`                           | `<func> [ref]`                                      |
| `scroll` → `eval`          | `<selector> <direction>`                 | `"el => el.scrollIntoView({block:'center'})" <ref>` |
| `wait` → `eval`            | `<text> [--timeout ms]`                  | `<js expression>`                                   |

#### 2.4 Domain check update

```rust
// Old: check for action == "open" || action == "navigate"
// New: check for action == "goto" || action == "open"
pub fn check_domain(&self, action: &str, params_json: &str) -> Result<(), String> {
    if action != "goto" && action != "open" {
        return Ok(());
    }
    // ... rest unchanged
}
```

#### 2.5 Download Implementation

playwright-cli has no native `download` command. Implement download handling in BrowserManager as a multi-step operation:

```rust
async fn execute_download(
    &self,
    session_id: &str,
    ref_selector: &str,
    target_path: Option<&str>,
    timeout_ms: u64,
) -> Result<BrowserCommandResult> {
    let download_dir = self.downloads_dir(session_id);

    // 1. Snapshot the directory before click (list existing files)
    let before: HashSet<PathBuf> = list_files(&download_dir);

    // 2. Click the download trigger element
    self.execute_single(session_id, "click", ref_selector).await?;

    // 3. Poll for new file in download_dir
    //    - Check every 500ms until timeout
    //    - A file is "new" if it's not in `before` set
    //    - A file is "complete" if:
    //      (a) no .crdownload / .part / .tmp suffix, AND
    //      (b) file size is stable across two consecutive checks
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        if Instant::now() > deadline {
            return Err(anyhow!("download timed out after {}ms", timeout_ms));
        }
        let after = list_files(&download_dir);
        let new_files: Vec<_> = after.difference(&before).collect();
        if let Some(file) = new_files.iter().find(|f| is_download_complete(f)) {
            // 4. Optionally move to target_path
            let final_path = match target_path {
                Some(p) => { fs::rename(file, p).await?; PathBuf::from(p) }
                None => file.to_path_buf(),
            };
            return Ok(BrowserCommandResult {
                success: true,
                result_json: format!("Downloaded: {}", final_path.display()),
                binary_data: fs::read(&final_path).await?,
                binary_mime: mime_from_extension(&final_path),
                ..Default::default()
            });
        }
    }
}

fn is_download_complete(path: &Path) -> bool {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    !name.ends_with(".crdownload") && !name.ends_with(".part") && !name.ends_with(".tmp")
}
```

**Key considerations:**

- `downloads_dir` must be pre-configured and passed to playwright-cli via the config or `open --persistent` with a known profile path
- The `POST /wait/download` route reuses the same logic but skips the `click` step (assumes download was already triggered)
- Default timeout uses `config.default_timeout_ms` (30s), can be overridden by the request body `timeout` field

#### 2.6 Wait (text) Implementation

playwright-cli has no native `wait` command. Implement text wait as a polling loop in BrowserManager:

```rust
async fn execute_wait_for_text(
    &self,
    session_id: &str,
    text: &str,
    timeout_ms: u64,
) -> Result<BrowserCommandResult> {
    let escaped = text.replace('\'', "\\'").replace('\\', "\\\\");
    let js_expr = format!(
        "() => document.body.innerText.includes('{}')",
        escaped
    );

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let poll_interval = Duration::from_millis(500);

    loop {
        let result = self.execute_single(session_id, "eval", &js_expr).await?;
        // playwright-cli eval outputs the return value as text
        // "true" means the text was found
        if result.result_json.trim() == "true" {
            return Ok(BrowserCommandResult {
                success: true,
                result_json: format!("Text '{}' found on page", text),
                ..Default::default()
            });
        }

        if Instant::now() + poll_interval > deadline {
            return Ok(BrowserCommandResult {
                success: false,
                error: format!(
                    "Timeout: text '{}' not found within {}ms",
                    text, timeout_ms
                ),
                ..Default::default()
            });
        }

        tokio::time::sleep(poll_interval).await;
    }
}
```

**Key considerations:**

- Polls every 500ms (not too aggressive, not too slow)
- Timeout defaults to `config.default_timeout_ms`, overridable by request
- Returns success=false on timeout (not an error — the page may still be loading)
- Text is escaped to prevent JS injection in the eval expression

### 3. BrowserConfig (aHand: `crates/ahandd/src/config.rs`)

Remove fields:

- `home_dir` (was for AGENT_BROWSER_HOME / daemon.js location)
- `socket_dir` (was for IPC socket directory)

Keep fields:

- `enabled`, `binary_path`, `executable_path`, `browsers_path`
- `default_timeout_ms`, `max_sessions`
- `allowed_domains`, `denied_domains`
- `downloads_dir`, `headed`

Add field:

- `persistent: Option<bool>` — when true, pass `--persistent` to `open` command so cookies/storage survive browser restarts. Default `true` for agent use cases (login sessions must persist across operations)

### 4. Installation (aHand: `crates/ahandd/src/browser_init.rs`)

Reduce from 6 steps to 3:

| Step              | Action                                                   | Details                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Node.js        | Detect or install Node.js >= 20                          | Reuse existing logic (check `~/.ahand/node/bin/node`, system PATH, auto-download). Minimum version 20 matches existing `NODE_MIN_VERSION` constant                                                                  |
| 2. playwright-cli | `~/.ahand/node/bin/npm install -g @playwright/cli@0.1.1` | Replace GitHub release download of agent-browser binary. Use aHand-managed npm to ensure binary lands at `~/.ahand/node/bin/playwright-cli` (no sudo needed). Must use pinned version matching Target version above |
| 3. Browser        | `playwright-cli install`                                 | Replaces manual Chrome detection + `npx playwright install chromium`. playwright-cli's install auto-detects system Chrome or installs Chromium                                                                      |

Remove steps:

- Step 3 (old): daemon.js bundle download
- Step 4 (old): socket directory creation
- Step 6 (old): env.sh generation

### 5. Team9 Desktop App

#### 5.1 Tauri backend (`apps/client/src-tauri/src/ahand.rs`)

- `browser_init_with_progress()`: Emit 3 steps instead of 6. Step names: `browser-node`, `browser-cli`, `browser-chromium`
- `browser_is_ready()`: Check `playwright-cli --version` exit code instead of checking for agent-browser binary + daemon.js + sockets
- `write_config()`: Keep writing `[browser] enabled = true` (unchanged)
- Remove `BROWSER_STEP_MAP` entries for `browser-daemon`, `browser-socket`, `browser-config`
- Simplify `augmented_path()` — still needed for Node.js discovery

#### 5.2 Frontend store (`apps/client/src/stores/useAHandSetupStore.ts`)

- Remove step definitions for `browser-daemon`, `browser-socket`, `browser-config`
- Keep: `browser-node`, `browser-cli`, `browser-chromium`
- Update step count from 6 to 3 for browser setup phase

### 6. Deletion Checklist

#### aHand

- [ ] `packages/browser-bridge/` — entire package (daemon.js bundler)
- [ ] `browser_init.rs`: steps 3 (daemon download), 4 (socket dir), 6 (env.sh)
- [ ] `browser.rs`: `daemon_home()` method, daemon.js check in `check_prerequisites()`
- [ ] `browser.rs`: all `AGENT_BROWSER_*` env vars in `build_env_vars()`
- [ ] `browser.rs`: `CliResponse` struct (no longer parsing JSON)
- [ ] `config.rs`: `home_dir` and `socket_dir` fields from `BrowserConfig`
- [ ] Agent-browser release download logic in `browser_init.rs` (step 2 old)
- [ ] `scripts/dist/setup-browser.sh` — rewrite to use `npm install -g @playwright/cli` + `playwright-cli install`
- [ ] `.github/workflows/release-browser.yml` — remove or repurpose (no longer building daemon.js bundles)
- [ ] `e2e/scripts/setup-browser.bats` — update E2E tests for new 3-step install flow

- [ ] `browser_init.rs`: agent-browser GitHub release URL constants (e.g., `AGENT_BROWSER_VERSION`, download URL templates)
- [ ] `browser_init.rs`: `detect_system_chrome()` — replaced by `playwright-cli install` auto-detection
- [ ] Any `ahandd --help` or `ahandctl` subcommand text referencing `agent-browser`
- [ ] Documentation/README references to `agent-browser`

#### Upgrade path for existing users

- [ ] Add migration logic: if `~/.ahand/bin/agent-browser` exists, print deprecation notice and suggest re-running `browser-init`
- [ ] Clean up old artifacts: `~/.ahand/browser/dist/daemon.js`, `~/.ahand/browser/sockets/`, `~/.ahand/browser/env.sh` can be deleted on next `browser-init --force`

#### Team9

- [ ] `useAHandSetupStore.ts`: `browser-daemon`, `browser-socket`, `browser-config` step definitions
- [ ] `ahand.rs`: `BROWSER_STEP_MAP` entries for removed steps
- [ ] `ahand.rs`: daemon.js path checks in `browser_is_ready()`

### 7. Unchanged Components

- `handle_browser_proxy()` overall structure (receive → translate → execute → format response). **Note:** the `result_json` → `result_value` wrapping must be updated per §1.6 (JSON parse with text fallback)
- Domain restriction logic (`check_domain`, `extract_domain`, `domain_matches`)
- Session counting and max_sessions limit
- File reading and base64 encoding for binary responses
- `browser.proto` protocol definition — field names and types unchanged. `result_json` field will contain plain text stdout instead of structured JSON. No protocol version bump needed since the field is typed as `string`.
- OpenClaw `browser-tool.ts` — **verified safe**. `BrowserProxyResult.result` is typed as `unknown`; `applyProxyPaths()` accesses `.path`/`.imagePath`/`.download.path` but these return `undefined` harmlessly on string values. Snapshot results are not JSON.parsed — the text is passed through to AI agents. File data flows via `files[]` array (base64), not through `result.path`
- `BrowserCommandResult` struct (fields reused with different content semantics)

### 8. Risk Assessment

| Risk                                                                    | Severity     | Mitigation                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| playwright-cli text output format changes between versions              | Medium       | Pin `@playwright/cli@0.1.1` in install step; parse loosely; add version check on startup                                                                                                                                                                                                         |
| `fill` vs `type` semantic difference (set value vs simulate keystrokes) | Medium       | Default to `fill` (~90% of cases). For autocomplete/search-as-you-type scenarios, AI agent can explicitly request `click` + `type` combo. Document the difference in aHand's browser command reference                                                                                           |
| No `--full-page` screenshot flag                                        | Low          | Workaround: `eval "() => document.body.scrollHeight"` → `resize <w> <fullHeight>` → `screenshot` → `resize <w> <originalHeight>`. Accept viewport-only screenshot for initial version; implement full-page workaround as follow-up                                                               |
| `snapshot` output format change (JSON → YAML)                           | Low          | **Verified safe:** OpenClaw `browser-tool.ts` does not JSON.parse snapshot results. Result is passed as `unknown` through to AI agent. YAML format is acceptable                                                                                                                                 |
| `download` command removed                                              | High         | Implement via `click` + filesystem polling with completion detection (see §2.5). Handles .crdownload/.part temp files, timeout, and stable-size check. Most complex new code — prioritize testing                                                                                                |
| `wait` command removed                                                  | Medium       | Implement via `eval` polling loop with 500ms interval and configurable timeout (see §2.6). New Rust code in BrowserManager                                                                                                                                                                       |
| `hover` side-effects if used for scroll                                 | Low          | Use `eval scrollIntoView` instead of `hover` to avoid triggering CSS hover states                                                                                                                                                                                                                |
| `type` + `submit: true` behavior change                                 | Low          | After `fill`, send additional `press Enter` when `submit` param is true                                                                                                                                                                                                                          |
| `result_json` format change (JSON → text)                               | **Critical** | **Verified:** `handle_browser_proxy` in handler.rs JSON-parses `result_json` — falls back to `Null` on failure, losing all output. **Must fix** per §1.6: use `unwrap_or_else` to wrap as `Value::String`. OpenClaw `browser-tool.ts` is safe (`result: unknown`, no JSON.parse on result field) |
| Tab ID → index mapping for `DELETE /tabs/<id>`                          | Low          | Implement `close_tab_by_id()` helper: `tab-list` → find index → `tab-close <index>`. Adds one extra CLI call per tab close                                                                                                                                                                       |
| `--persistent` session behavior                                         | Low          | Default `persistent: true` in BrowserConfig so agent login sessions survive restarts. Document that non-persistent mode loses cookies on browser close                                                                                                                                           |
| Global npm install path                                                 | Low          | Use `~/.ahand/node/bin/npm` for install so binary lands at `~/.ahand/node/bin/playwright-cli` — no sudo needed, already on augmented PATH                                                                                                                                                        |
