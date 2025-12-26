# Edition Guide: Community vs Enterprise

本指南说明如何在开发和部署中使用社区版和企业版。

## 目录结构

```
team9/
├── apps/server/
│   ├── apps/gateway/src/
│   │   ├── edition/          # 版本控制模块
│   │   │   ├── edition.enum.ts
│   │   │   ├── edition.service.ts
│   │   │   ├── edition.module.ts
│   │   │   ├── decorators/
│   │   │   │   └── require-feature.decorator.ts
│   │   │   └── guards/
│   │   │       └── feature.guard.ts
│   │   └── ...
│   └── libs/                  # 开源核心模块
│
├── enterprise/                # 企业版模块 (私有)
│   └── libs/
│       ├── tenant/           # 多租户
│       ├── sso/              # SSO认证
│       ├── audit/            # 审计日志
│       ├── analytics/        # 高级分析
│       └── license/          # License验证
│
└── .gitmodules.example       # Git Submodule 配置示例
```

## 开发者指南

### 内部开发者 (有企业仓库权限)

```bash
# 1. 克隆仓库 (包含子模块)
git clone --recurse-submodules git@github.com:your-org/team9.git
cd team9

# 2. 安装依赖
cd apps/server
pnpm install

# 3. 运行企业版
pnpm dev:enterprise

# 4. 构建企业版
pnpm build:enterprise
```

### 开源贡献者 (无企业仓库权限)

```bash
# 1. 克隆仓库 (不包含企业模块)
git clone https://github.com/your-org/team9.git
cd team9

# 2. 安装依赖
cd apps/server
pnpm install

# 3. 运行社区版
pnpm dev

# 4. 构建社区版
pnpm build:community
```

## 可用命令

| 命令                    | 说明               |
| ----------------------- | ------------------ |
| `pnpm dev`              | 开发模式运行社区版 |
| `pnpm dev:enterprise`   | 开发模式运行企业版 |
| `pnpm build:community`  | 构建社区版         |
| `pnpm build:enterprise` | 构建企业版         |
| `pnpm start:community`  | 生产模式运行社区版 |
| `pnpm start:enterprise` | 生产模式运行企业版 |
| `pnpm submodule:init`   | 初始化企业子模块   |
| `pnpm submodule:update` | 更新企业子模块     |

## 环境变量

```bash
# .env 文件中设置版本
EDITION=community    # 或 enterprise

# 企业版需要License Key
LICENSE_KEY=your-license-key
```

## 功能对比

| 功能                |  社区版  |   企业版    |
| ------------------- | :------: | :---------: |
| 基础认证            |    ✅    |     ✅      |
| 频道 (公开/私有)    |    ✅    |     ✅      |
| 私信                |    ✅    |     ✅      |
| 文件上传            | ✅ (5GB) | ✅ (无限制) |
| 用户数限制          |   100    |   无限制    |
| 频道数限制          |    50    |   无限制    |
| **多租户**          |    ❌    |     ✅      |
| **SSO (SAML/OIDC)** |    ❌    |     ✅      |
| **审计日志**        |    ❌    |     ✅      |
| **高级分析**        |    ❌    |     ✅      |

## 在代码中使用功能守卫

```typescript
import { Controller, Get, UseGuards } from "@nestjs/common";
import { FeatureGuard, RequireFeature, FeatureFlag } from "../edition";

@Controller("tenants")
@UseGuards(FeatureGuard)
@RequireFeature(FeatureFlag.MULTI_TENANT) // 整个控制器需要企业版
export class TenantController {
  @Get()
  findAll() {
    // 仅企业版可访问
  }
}

// 或者在单个路由上使用
@Controller("analytics")
export class AnalyticsController {
  @Get("basic")
  getBasic() {
    // 所有版本可访问
  }

  @Get("advanced")
  @UseGuards(FeatureGuard)
  @RequireFeature(FeatureFlag.ADVANCED_ANALYTICS)
  getAdvanced() {
    // 仅企业版可访问
  }
}
```

## 设置私有企业仓库

1. 创建私有 Git 仓库 (如 `github.com/your-org/team9-enterprise`)

2. 将 `enterprise/` 目录推送到私有仓库:

   ```bash
   cd enterprise
   git init
   git add .
   git commit -m "Initial enterprise modules"
   git remote add origin git@github.com:your-org/team9-enterprise.git
   git push -u origin main
   ```

3. 在主仓库中设置 submodule:

   ```bash
   cd ..
   rm -rf enterprise
   git submodule add git@github.com:your-org/team9-enterprise.git enterprise
   git commit -m "Add enterprise submodule"
   ```

4. 重命名 `.gitmodules.example` 为 `.gitmodules`

## CI/CD 配置示例

### GitHub Actions (社区版)

```yaml
name: Build Community
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: cd apps/server && pnpm install
      - run: cd apps/server && pnpm build:community
```

### GitHub Actions (企业版 - 私有)

```yaml
name: Build Enterprise
on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
          token: ${{ secrets.ENTERPRISE_REPO_TOKEN }}
      - uses: pnpm/action-setup@v2
      - run: cd apps/server && pnpm install
      - run: cd apps/server && pnpm build:enterprise
```
