# Edition Guide: Community vs Enterprise

This guide explains how to use the Community and Enterprise editions in development and deployment.

## Directory Structure

```
team9/
├── apps/server/
│   ├── apps/gateway/src/
│   │   ├── edition/          # Edition control module
│   │   │   ├── edition.enum.ts
│   │   │   ├── edition.service.ts
│   │   │   ├── edition.module.ts
│   │   │   ├── decorators/
│   │   │   │   └── require-feature.decorator.ts
│   │   │   └── guards/
│   │   │       └── feature.guard.ts
│   │   └── ...
│   └── libs/                  # Open source core modules
│
├── enterprise/                # Enterprise edition modules (private)
│   └── libs/
│       ├── tenant/           # Multi-tenancy
│       ├── sso/              # SSO authentication
│       ├── audit/            # Audit logs
│       ├── analytics/        # Advanced analytics
│       └── license/          # License verification
│
└── .gitmodules.example       # Git Submodule configuration example
```

## Developer Guide

### Internal Developers (with Enterprise repository access)

```bash
# 1. Clone repository (including submodules)
git clone --recurse-submodules git@github.com:your-org/team9.git
cd team9

# 2. Install dependencies
cd apps/server
pnpm install

# 3. Run Enterprise edition
pnpm dev:enterprise

# 4. Build Enterprise edition
pnpm build:enterprise
```

### Open Source Contributors (without Enterprise repository access)

```bash
# 1. Clone repository (without Enterprise modules)
git clone https://github.com/your-org/team9.git
cd team9

# 2. Install dependencies
cd apps/server
pnpm install

# 3. Run Community edition
pnpm dev

# 4. Build Community edition
pnpm build:community
```

## Available Commands

| Command                 | Description                               |
| ----------------------- | ----------------------------------------- |
| `pnpm dev`              | Run Community edition in dev mode         |
| `pnpm dev:enterprise`   | Run Enterprise edition in dev mode        |
| `pnpm build:community`  | Build Community edition                   |
| `pnpm build:enterprise` | Build Enterprise edition                  |
| `pnpm start:community`  | Run Community edition in production mode  |
| `pnpm start:enterprise` | Run Enterprise edition in production mode |
| `pnpm submodule:init`   | Initialize Enterprise submodule           |
| `pnpm submodule:update` | Update Enterprise submodule               |

## Environment Variables

```bash
# Set edition in .env file
EDITION=community    # or enterprise

# Enterprise edition requires License Key
LICENSE_KEY=your-license-key
```

## Feature Comparison

| Feature                   | Community |   Enterprise   |
| ------------------------- | :-------: | :------------: |
| Basic Authentication      |    ✅     |       ✅       |
| Channels (Public/Private) |    ✅     |       ✅       |
| Direct Messages           |    ✅     |       ✅       |
| File Upload               | ✅ (5GB)  | ✅ (Unlimited) |
| User Limit                |    100    |   Unlimited    |
| Channel Limit             |    50     |   Unlimited    |
| **Multi-tenancy**         |    ❌     |       ✅       |
| **SSO (SAML/OIDC)**       |    ❌     |       ✅       |
| **Audit Logs**            |    ❌     |       ✅       |
| **Advanced Analytics**    |    ❌     |       ✅       |

## Using Feature Guards in Code

```typescript
import { Controller, Get, UseGuards } from "@nestjs/common";
import { FeatureGuard, RequireFeature, FeatureFlag } from "../edition";

@Controller("tenants")
@UseGuards(FeatureGuard)
@RequireFeature(FeatureFlag.MULTI_TENANT) // Entire controller requires Enterprise edition
export class TenantController {
  @Get()
  findAll() {
    // Only accessible in Enterprise edition
  }
}

// Or use on individual routes
@Controller("analytics")
export class AnalyticsController {
  @Get("basic")
  getBasic() {
    // Accessible in all editions
  }

  @Get("advanced")
  @UseGuards(FeatureGuard)
  @RequireFeature(FeatureFlag.ADVANCED_ANALYTICS)
  getAdvanced() {
    // Only accessible in Enterprise edition
  }
}
```

## Setting Up Private Enterprise Repository

1. Create a private Git repository (e.g., `github.com/your-org/team9-enterprise`)

2. Push the `enterprise/` directory to the private repository:

   ```bash
   cd enterprise
   git init
   git add .
   git commit -m "Initial enterprise modules"
   git remote add origin git@github.com:your-org/team9-enterprise.git
   git push -u origin main
   ```

3. Set up submodule in the main repository:

   ```bash
   cd ..
   rm -rf enterprise
   git submodule add git@github.com:your-org/team9-enterprise.git enterprise
   git commit -m "Add enterprise submodule"
   ```

4. Rename `.gitmodules.example` to `.gitmodules`

## CI/CD Configuration Examples

### GitHub Actions (Community Edition)

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

### GitHub Actions (Enterprise Edition - Private)

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
