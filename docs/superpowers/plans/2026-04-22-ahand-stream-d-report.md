# Stream D 完成报告

**日期：** 2026-04-22  
**PR：** https://github.com/team9ai/team9/pull/52  
**分支：** `feat/ahand-stream-d`  
**状态：** ✅ 全部 12 个 task 完成，4 轮 review-loop + Codex review 通过，可 merge

---

## 1. 任务完成情况

### Phase I — 数据库 schema（无跨流依赖）

| Task | SHA        | 标题                                               |
| ---- | ---------- | -------------------------------------------------- |
| 4.1  | `4c12800f` | `im_ahand_devices` Drizzle schema + migration 0043 |

### Phase II — Gateway ahand 模块（Barrier B-D-A 解锁后）

| Task    | SHA        | 标题                                                   |
| ------- | ---------- | ------------------------------------------------------ |
| 4.2     | `a587dac2` | `AhandHubClient` HTTP wrapper（hub admin APIs）        |
| 4.3     | `38bf4797` | `AhandDevicesService` 业务逻辑                         |
| 4.4+4.5 | `5cd47615` | REST + 内部控制器                                      |
| 4.6     | `3cda6488` | Hub webhook 接收器 + events gateway                    |
| 4.7     | `e0413c37` | Redis pub/sub + Socket.io WS gateway                   |
| 4.8     | `5785ac7f` | `AhandModule` wiring（→ Phase II push，解锁 Stream E） |

### Phase III — im-worker 订阅层（4.5 完成后）

| Task | SHA        | 标题                                     |
| ---- | ---------- | ---------------------------------------- |
| 5.1  | `06526f89` | `AhandControlPlaneClient`                |
| 5.3  | `90051054` | `AhandEventsSubscriber` Redis PSUBSCRIBE |

### Phase IV — im-worker blueprint + dispatcher（Barrier B-D-B 解锁后）

| Task    | SHA        | 标题                                                    |
| ------- | ---------- | ------------------------------------------------------- |
| 5.2+5.4 | `6d5973b9` | blueprint extender + session dispatcher + module wiring |

---

## 2. Review 总结

经过逐 task spec review + 4 轮 review-loop + Codex 独立审计，共修复 **46 个问题**（Critical 4, Important 25, Minor 17）。主要修复：

- **路由 Critical**：所有 ahand 控制器从 `@Controller('api/ahand/...')` 改为 `{ path: 'ahand/...', version:'1' }` — 原写法在 `setGlobalPrefix('api')` + URI versioning 下会产生重复前缀 `/api/v1/api/ahand/...`
- **Auth Critical**：`AhandEventsGateway.onJoinRoom` 补 `@UseGuards(WsAuthGuard)`；读取 `client.user.sub`（WsAuthGuard 写入位置）而非原先的 `client.data?.user?.id`
- **Webhook 安全**：HMAC 验证补充 non-hex 字符拒绝 + `timingSafeEqual` RangeError 保护
- **业务逻辑**：`device.revoked` 加 `AND status='active'` + `.returning()` 防重复 fan-out；`onUserDeleted` 补 Redis publish；`revokeDevice` publish 改为 fire-and-forget
- **降级保护**：Redis 宕机 + `includeOffline:false` 时返回所有设备（`isOnline:null`）而非空列表
- **Redis key 中心化**：抽出 `ahand-redis-keys.ts`（`devicePresenceKey` / `webhookDedupeKey`），消除两处重复定义
- **重新订阅**：`AhandEventsSubscriber.onModuleInit` PSUBSCRIBE 失败时不再 crash worker；`connect` 事件上显式 re-subscribe（ioredis 只自动恢复成功过的订阅）

---

## 3. 关键决策（联调需知）

### 3.1 路由路径

| 端点                         | 实际 URL                                       |
| ---------------------------- | ---------------------------------------------- |
| Tauri 设备注册/列表/撤销     | `/api/v1/ahand/devices/*`                      |
| im-worker 获取控制平面 token | `/api/v1/internal/ahand/control-plane/token`   |
| im-worker 列出用户设备       | `/api/v1/internal/ahand/devices/list-for-user` |
| hub webhook 接收             | `/api/v1/ahand/hub-webhook`                    |

> **注意**：`GATEWAY_INTERNAL_URL` 环境变量需包含路径前缀，例如 `http://gateway:3000`，im-worker client 会自动拼 `/api/v1/internal/ahand/*`。

### 3.2 Guard 约定

- **Tauri REST**：`AuthGuard`（`@team9/auth`，Bearer JWT）
- **im-worker RPC**：`InternalAuthGuard`（Bearer `INTERNAL_AUTH_VALIDATION_TOKEN`，constant-time 比较）
- **hub webhook**：无 JwtAuthGuard，仅 HMAC-SHA256 签名验证（`AHAND_HUB_WEBHOOK_SECRET`）

### 3.3 Redis token 约定

- 注入 token：`REDIS_CLIENT`（来自 `@team9/redis`）
- Presence key 格式：`ahand:device:{hubDeviceId}:presence`（值为 `"online"`）
- Webhook dedupe key：`ahand:webhook:seen:{eventId}`（EX 600s）
- Pub/sub channel：`ahand:events:{ownerId}`（im-worker PSUBSCRIBE `ahand:events:*`）

> **重要**：key 格式定义在 `apps/server/apps/gateway/src/ahand/ahand-redis-keys.ts`，gateway 和 im-worker 两边都用这里的 builder，不要手写字符串。

### 3.4 clientContext 承载方式

`clientContext` 通过 `messages.metadata.clientContext` 传递（无新列），格式：

```json
{ "kind": "macapp", "deviceId": "<hubDeviceId>" }
// 或
{ "kind": "web" }
```

im-worker `AhandBlueprintExtender` 在 session 启动时读取并解析。

### 3.5 AhandSessionDispatcher 设计限制

`AhandSessionDispatcher` 当前为**纯追踪 registry**，不做热组件注入（`addComponent`/`removeComponent`）。原因：im-worker 通过 HTTP 调用 ClawHiveService，无法直接访问 claw-hive-worker 进程内的 `AgentSession`，且 claw-hive-api 暂无对应 REST 端点。

设备上下线变化会更新内存 `AhandSessionTrackingService`，**下次 session 启动**时 `AhandBlueprintExtender` 会读取最新设备状态重建 blueprint。热注入待 Stream B 暴露 REST 端点后接入。

### 3.6 AhandEventsGateway 与 WebsocketGateway

两个 `@WebSocketGateway` 共享 `/im` namespace。NestJS/Socket.io 在同一 namespace 下**共享同一 Server 实例**，因此 WebsocketGateway 上配置的 Redis adapter 自动对 AhandEventsGateway 生效。`emitToOwner` 发出的事件名为 plain `eventType`（如 `device.online`），无 `ahand:` 前缀（与 spec §3.6 对齐）。

### 3.7 Blueprint extender 安全注意

`INTERNAL_AUTH_VALIDATION_TOKEN` 被嵌入 blueprint component config（`gatewayInternalAuthToken` 字段），下发给 claw-hive worker。这是长生命周期内部服务令牌，已在代码中标注 `SECURITY` 注释。生产环境**不得在 DEBUG 级别日志中打印 component config**。中期应改为 per-session 短期令牌。

---

## 4. 测试覆盖

| 范围            | 测试数 | Stmt  | Line  |
| --------------- | ------ | ----- | ----- |
| Gateway ahand   | 155    | 97.8% | 98.2% |
| im-worker ahand | 79     | 97.9% | 98.2% |

所有 uncovered lines 为 NestJS decorator 元数据（`@Injectable` constructor、`@WebSocketGateway` CORS callback 等），属于 V8 不可覆盖范畴，与项目现有模块一致。

---

## 5. 环境变量汇总

| 变量                             | 服务                | 说明                                            |
| -------------------------------- | ------------------- | ----------------------------------------------- |
| `AHAND_HUB_URL`                  | gateway             | ahand-hub 基础 URL（如 `https://hub.ahand.ai`） |
| `AHAND_HUB_SERVICE_TOKEN`        | gateway             | hub admin API bearer token                      |
| `AHAND_HUB_WEBHOOK_SECRET`       | gateway             | hub → gateway webhook HMAC 密钥                 |
| `GATEWAY_INTERNAL_URL`           | im-worker           | gateway base URL（如 `http://gateway:3000`）    |
| `INTERNAL_AUTH_VALIDATION_TOKEN` | gateway + im-worker | 双方共享内部服务令牌                            |

以上变量均为 optional（未配置时 ahand 功能降级，不影响其他模块）。
