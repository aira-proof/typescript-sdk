# Aira TypeScript SDK — Engineering Guidelines

## Project

TypeScript SDK for Aira — `npm install aira-sdk`. Single async client with sub-imports for integrations.

## Stack

- **HTTP**: native fetch
- **Testing**: vitest
- **Build**: tsup
- **Package**: aira-sdk on npm

## Structure

```
src/
  index.ts          # Main exports
  client.ts         # Aira class (all API methods)
  types.ts          # TypeScript interfaces (ActionReceipt, AgentDetail, etc.)
  session.ts        # AiraSession (scoped defaults)
  offline.ts        # OfflineQueue
  extras/
    langchain.ts    # AiraCallbackHandler
    vercel-ai.ts    # AiraVercelMiddleware
    openai-agents.ts # AiraGuardrail
    mcp.ts          # MCP server factory
    webhooks.ts     # HMAC signature verification
    trust.ts        # Trust policy helpers
```

## Commands

```bash
# Run tests
npm test

# Build
npm run build

# Type check
npx tsc --noEmit
```

## Conventions

### Client Methods
- All methods async, return `Promise<T>`
- Single params object (not spread args): `notarize({ actionType, details, ... })`
- camelCase in SDK, snake_case in API bodies — `buildBody()` handles conversion
- Use `buildBody()` to filter undefined/null values
- Mirror Python SDK method names (camelCase equivalent)

### Types
- All response types as `interface` in `types.ts`
- Optional fields use `?:` — required fields don't
- Keep in sync with Python SDK types and backend schemas

### Extras
- Sub-imports: `import { ... } from "aira-sdk/extras/langchain"`
- Package.json `exports` field maps each extra
- Peer dependencies for frameworks (not bundled)

### Version
- `package.json` version only
- Publish via GitHub Release → triggers `Publish to npm` workflow

### Git Workflow
- Feature branches: `feat/feature-name`
- Always create PRs
- CI: `npm test` must pass
- Tag releases: `v0.X.Y`
