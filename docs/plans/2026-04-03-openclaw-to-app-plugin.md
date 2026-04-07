# OpenClaw 降级为普通 App & Base-Model-Staff 默认安装

## 背景

当前后端在创建 workspace 时会自动安装 OpenClaw（`type: 'managed'`，用户不可卸载）。现在需要：

1. OpenClaw 改为普通的 `custom` app，不再自动安装，用户可自行安装/卸载
2. Base-Model-Staff 保持 `custom`（可卸载），但新增 `autoInstall` 标志，新建 workspace 时自动安装

## 改动清单

### 1. 类型定义 — `application.types.ts`

`Application` 接口新增可选字段：

```typescript
/** If true, this application is automatically installed when a workspace is created */
autoInstall?: boolean;
```

### 2. 应用列表 — `applications.service.ts`

- `openclaw`: `type: 'managed'` → `type: 'custom'`
- `base-model-staff`: 新增 `autoInstall: true`
- 新增方法 `findAutoInstall(): Application[]`，返回所有 `autoInstall === true && enabled` 的 app

### 3. Workspace 创建 — `workspace.service.ts`

将硬编码的 `install(workspace.id, data.ownerId, { applicationId: 'openclaw' })` 替换为：

```typescript
const autoInstallApps = this.applicationsService.findAutoInstall();
for (const app of autoInstallApps) {
  try {
    await this.installedApplicationsService.install(
      workspace.id,
      data.ownerId,
      { applicationId: app.id },
    );
    this.logger.log(
      `Auto-installed ${app.name} for workspace: ${workspace.name}`,
    );
  } catch (error) {
    this.logger.warn(
      `Failed to auto-install ${app.name} for workspace: ${error}`,
    );
  }
}
```

### 4. 前端 — 无需改动

- `ApplicationMainContent.tsx` 的 `app.type !== "managed"` 过滤 → openclaw 变成 custom 后自然出现在 Available Apps
- `ApplicationDetailContent.tsx` 的 managed 检查 → openclaw 变成 custom 后自动支持卸载/禁用
- base-model-staff 保持 custom，用户仍可卸载

### 5. 已有数据兼容性

- 已有 workspace 中已安装的 openclaw 记录不受影响（DB 记录保留）
- 用户现在可以卸载 openclaw（不再是 managed）
- 已有 workspace 不会自动补装 base-model-staff（仅影响新创建的 workspace）

## 涉及文件

| 文件                                                                | 改动类型                 |
| ------------------------------------------------------------------- | ------------------------ |
| `apps/server/apps/gateway/src/applications/application.types.ts`    | 新增 `autoInstall` 字段  |
| `apps/server/apps/gateway/src/applications/applications.service.ts` | 修改 app 定义 + 新增方法 |
| `apps/server/apps/gateway/src/workspace/workspace.service.ts`       | 替换自动安装逻辑         |
