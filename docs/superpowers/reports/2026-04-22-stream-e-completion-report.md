# Stream E 完成报告

**分支：** `feat/ahand-stream-e` → `dev`  
**PR：** [#51](https://github.com/team9ai/team9/pull/51)  
**完成时间：** 2026-04-22  
**负责范围：** `apps/client/**`（Tauri Rust + React/TS 前端）

---

## 一、任务完成情况

### Phase I — i18n 资源（Task 8.6）✅

- 新增 `ahand` i18n namespace，覆盖全部 12 个 locale（en/zh-CN/zh-TW/ja/ko/es/pt/fr/de/it/nl/ru）
- **35 个 key**，涵盖：设备管理操作、状态标签、错误提示（resumeFailed/deviceRevoked/autoRefreshFailed/nicknameSaveFailed）、Web CTA 文案
- 注册到 `loadLanguage.ts` NAMESPACES、`index.ts` 预加载、`i18next.d.ts` 类型声明
- 38 个测试验证跨 locale 的 key 对等性和插值占位符一致性

### Phase II — Tauri Rust 嵌入（Tasks 7.1–7.4）✅

| Task | Commit     | 内容                                                                                                                                                                     |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7.1  | `615a8635` | 删除 legacy `src/ahand.rs`（513 行 sidecar 代码），移除 `externalBin`，CI 去掉 sidecar 下载步骤，Cargo.toml 新增 `ahandd` git dep                                        |
| 7.2  | `a4cf5cb8` | `identity.rs`：per-user 身份目录（`{app_data_dir}/ahand/users/{userId}/identity`），UUID 字符集校验，Unix 0700 权限，`device_id_from_dir()` 与 ahandd 算法保持一致       |
| 7.3  | `e3693a0d` | `AhandRuntime` 单例（`tokio::Mutex`），`start/stop/status/current_device_id`，status forwarder 任务，app-exit 清理钩子                                                   |
| 7.4  | `8b553d80` | 4 个 Tauri 命令：`ahand_get_identity`/`ahand_start`/`ahand_stop`/`ahand_status`/`ahand_clear_identity`，TS bindings（`tauri-ahand.ts`），invoke 封装（`ahand-tauri.ts`） |

**Rust 测试：** 24 个，全部通过。

### Phase III — 前端 API/Hook 层（Tasks 8.1–8.2）✅

| Task | Commit     | 内容                                                                                                                                               |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1  | `b52c5abd` | `useAhandStore`（Zustand persist，per-user `{enabled, deviceId, hubUrl}`），`buildClientContext()` 注入所有 `sendMessage` HTTP 调用                |
| 8.2  | `0137aa12` | `ahand-api.ts`（`/ahand/*` REST wrapper），`useAhandDevices`（React Query + WS room join/reconnect 重发），`useAhandLocalStatus`（Tauri 事件订阅） |

### Phase IV — UI + 自动恢复 + 清理（Tasks 8.3–8.5, 8.7）✅

| Task | Commit     | 内容                                                                                                                                                                        |
| ---- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.3  | `1bfdf10e` | `DevicesDialog`（env branch），`ThisMacSection`（5步注册流/remove/状态），`OtherDevicesList`（设备列表 + nickname 内联编辑 + remove），`WebCtaCard`（deep-link + 平台 URL） |
| 8.4  | `82c3965a` | `useAhandBootstrap`（登录恢复 + 登出停止），`MainSidebar` Laptop 按钮 + 状态点，`_authenticated.tsx` 挂载                                                                   |
| 8.5  | `4a3a3dc5` | `useAhandJwtRefresh`（auth error 触发 JWT 刷新，30s rate limit）                                                                                                            |
| 8.7  | `ff81bc38` | 删除 `useAHandSetupStore`/`useAHandStatus`/`AHandSetupDialog`/`LocalDeviceStatus` 等全部 legacy sidecar-era 代码                                                            |

### Review 和修复

- **Claude review-loop：** 2 轮，修复 WS 事件名、room join 缺失、`hubUrl` 未持久化、logout 未停 daemon、nickname 保存 i18n key 错误、MainSidebar test 残留 mock 等问题
- **Codex review（2轮）：** 修复 Tauri 命令未注册、URL 双重 `/api`、identity 磁盘未清理、reconnect 后 room 未重加入
- **Copilot review：** 2条修复（identity 测试助手、测试名修正），3条驳回（有据可查）

**最终测试：1310 TS + 24 Rust = 1334 tests，全部通过。**

---

## 二、关键实现决策

### ahandd Cargo 依赖

```toml
ahandd = { git = "https://github.com/team9ai/ahand", package = "ahandd", branch = "feat/ahand-stream-a" }
```

**待办：** Stream A 合并到 dev 后，改为 `tag = "rust-v0.1.2"`。

### clientContext 承载方式

- 字段名：`clientContext`（HTTP body 顶层，camelCase）
- 形状：`{ kind: "macapp"; deviceId: string | null } | { kind: "web" }`
- 注入点：`messagesApi.sendMessage` 内的 `buildClientContext()` 自动注入，不依赖调用方
- **注意：** 服务端 Stream D Task 4.8 需要在 `CreateMessageDto` 加 `clientContext` 字段，才能持久化和透传给 im-worker。客户端已正确实现，等 Stream D 落盘自动生效。

### device_id 派生方式

- Tauri shell 用 `device_id_from_dir(identity_dir)` 计算：SHA256(`"ahandd-device-id:" + identity_dir_path`)，前缀 `"dev-"`
- 与 `ahandd` 库内部 `default_device_id()` 算法完全一致
- **注意：** 这意味着 device_id 与 identity 目录路径绑定。如果 `app_data_dir` 变更（例如 macOS 应用迁移），device_id 会变，需要重新注册

### isTauriApp 位置

- **实际路径：** `@/lib/tauri`（plan 中写的是 `@/lib/env`，实际不存在）

### useCurrentUser 替换

- `useCurrentUser()` from `@/hooks/useAuth` 返回 React Query result（`{ data, isLoading }`），不能直接取 `currentUser`
- 所有需要同步读 userId 的地方改用 `useAppStore((s) => s.user)`

---

## 三、联调注意事项

### Stream A（ahandd 库）

1. **Cargo.toml pin 需要更新：** 等 Stream A PR 合并到 dev 后，将依赖从 `branch = "feat/ahand-stream-a"` 改为 `tag = "rust-v0.1.2"`
2. **DaemonStatus TS binding 合约：**
   ```ts
   export type DaemonStatus =
     | { state: "idle" }
     | { state: "connecting" }
     | { state: "online"; device_id: string }
     | { state: "offline" }
     | {
         state: "error";
         kind: "auth" | "network" | "other";
         message: string;
         device_id?: string;
       };
   ```
   Rust serde：`#[serde(tag = "state", rename_all = "camelCase")]`，`Online.device_id` 保持 snake_case（有显式 `#[serde(rename = "device_id")]`）
3. **spawn() API 合约：** `DaemonConfig::builder(hub_url, device_jwt, identity_dir).device_id(id).session_mode(AutoAccept).browser_enabled(false).heartbeat_interval(60s).build()`

### Stream D（gateway REST + DB schema）

1. **API 路径：** 客户端调用 `/ahand/*`（HttpClient baseURL 已含 `/api`，不要再加前缀）
   - `POST /ahand/devices` → 注册
   - `GET /ahand/devices` → 列表
   - `POST /ahand/devices/:id/token/refresh` → JWT 刷新（**注意：** 响应需包含 `hubUrl` 字段，否则 bootstrap 传空字符串给 daemon）
   - `PATCH /ahand/devices/:id` → 改名
   - `DELETE /ahand/devices/:id` → 删除
2. **RegisterDeviceResponse 必须包含 `hubUrl`：** `useAhandBootstrap` 和 `useAhandJwtRefresh` 在 resume/refresh 时从 store 读 `hubUrl`，初始值来自注册响应。若 `refreshToken` 接口也返回 `hubUrl`，可简化 bootstrap 逻辑（当前方案：注册时存入 store，刷新时从 store 读）。
3. **WS 事件名：** 服务端 emit 的是 `device.online`/`device.offline`/`device.revoked`/`device.registered`（不含 `ahand:` 前缀）。客户端 `useAhandDevices` 订阅的事件名与此一致。
4. **WS Room：** 客户端在 `useAhandDevices` mount 时发送 `ahand:join_room` 事件，服务端 `AhandEventsGateway` 需要处理此事件并将 socket 加入 `user:{userId}:ahand` room。
5. **`clientContext` DB 列：** Task 4.8 在 `messages` 表加 `client_context jsonb NULL`，并在 `send_message` WS handler 接受和持久化此字段。客户端已发送，服务端 DTO 对应字段名为 `clientContext`（camelCase）。
6. **AhandEventsGateway emit 的 room 名格式：** `user:{userId}:ahand`

### Phase 9（集成测试）

- **前置条件已满足：** Phase IV 全部代码已合并，legacy cleanup 完成
- **DaemonStatus TS binding** 见上方 Stream A 部分，供 claw-hive 合约对齐
- **Playwright E2E 可以开始**

---

## 四、已知 pending 项（不影响合并）

| 项目                           | 说明                                                       | 负责方                            |
| ------------------------------ | ---------------------------------------------------------- | --------------------------------- |
| Cargo.toml tag 更新            | `branch = "feat/ahand-stream-a"` → `tag = "rust-v0.1.2"`   | Stream E（等 Stream A 合并后）    |
| `clientContext` 服务端持久化   | `CreateMessageDto` 加字段                                  | Stream D Task 4.8                 |
| `refreshToken` 响应含 `hubUrl` | 简化 resume 逻辑                                           | Stream D Task 4.4（可 follow-up） |
| `ahand_clear_identity` 测试    | Tauri 命令层无法单元测试（需 AppHandle），Phase 9 E2E 覆盖 | Phase 9                           |

---

## 五、文件变更地图（核心）

```
apps/client/
├── src-tauri/src/ahand/
│   ├── mod.rs              # 模块导出
│   ├── identity.rs         # per-user 身份目录管理
│   ├── runtime.rs          # AhandRuntime 单例
│   └── commands.rs         # 5 个 Tauri 命令
├── src/
│   ├── types/tauri-ahand.ts        # TS 类型 bindings
│   ├── services/
│   │   ├── ahand-tauri.ts          # invoke() 封装
│   │   └── ahand-api.ts            # REST client
│   ├── stores/useAhandStore.ts     # 持久化 Zustand store
│   ├── hooks/
│   │   ├── useAhandLocalStatus.ts  # Tauri 事件订阅
│   │   ├── useAhandDevices.ts      # React Query + WS
│   │   ├── useAhandBootstrap.ts    # 登录恢复 + 登出停止
│   │   └── useAhandJwtRefresh.ts   # auth error 自动刷新
│   └── components/
│       ├── dialog/DevicesDialog.tsx
│       ├── dialog/devices/
│       │   ├── ThisMacSection.tsx
│       │   ├── OtherDevicesList.tsx
│       │   └── WebCtaCard.tsx
│       └── layout/MainSidebar.tsx  # +Laptop 按钮 patch
```
