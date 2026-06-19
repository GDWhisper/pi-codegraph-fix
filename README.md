# pi-codegraph-fix

[CodeGraph](https://colbymchenry.github.io/codegraph/) MCP sidecar for the [pi coding agent](https://github.com/earendil-works/pi).

Fixes the core problem that caused low codegraph adoption: **`process.cwd()`锁定**。

## The Fix

Both [colbymchenry/codegraph-pi](https://github.com/colbymchenry/codegraph-pi) and [SeanPedersen/pi-codegraph](https://github.com/SeanPedersen/pi-codegraph) used `process.cwd()` to locate `.codegraph/codegraph.db`:

```typescript
const dbPath = join(process.cwd(), ".codegraph", "codegraph.db");
//                ^^^^^^^^^^^^^
//                始终是 pi 进程启动目录，不是 session 工作目录
```

When you loaded a session from a different project (`pi session=<id>`), or when `pi` was launched from `~` instead of the project root, the DB file was never found → no codegraph tools were registered → 0% call rate.

**Fix:** Use `ctx.cwd` from `session_start` event:

```typescript
const projectRoot = ctx.cwd || process.cwd();
//                ^^^^^^^
//                当前 session 的工作目录，由 pi 提供
```

Plus: pass `cwd: projectRoot` when spawning `codegraph serve --mcp` so the subprocess also sees the correct project root.

## Features

| Feature | Source |
|---------|--------|
| `ctx.cwd` instead of `process.cwd()` | **pi-codegraph-fix** |
| `spawn` with explicit `cwd` | **pi-codegraph-fix** |
| Multi-project MCP clients (one per CWD) | SeanPedersen/pi-codegraph |
| Dynamic tool discovery via MCP `tools/list` | SeanPedersen/pi-codegraph |
| Process cleanup hooks (exit, SIGTERM, SIGHUP) | SeanPedersen/pi-codegraph |
| Self-contained single file (no separate mcp-client.ts) | SeanPedersen/pi-codegraph |
| `before_agent_start` system prompt injection (no APPEND_SYSTEM.md side effect) | colbymchenry/codegraph-pi |
| `.codegraph/codegraph.db` check (not just `.codegraph/` dir) | colbymchenry/codegraph-pi |

## Install

```bash
# Via local path (clone or copy)
pi install /path/to/pi-codegraph-fix

# Or reference in ~/.pi/agent/settings.json
```

```json
{
  "packages": ["/path/to/pi-codegraph-fix"]
}
```

## Requirements

- [CodeGraph](https://colbymchenry.github.io/codegraph/) CLI (`npm install -g @colbymchenry/codegraph`)
- Project must be indexed: `codegraph init` in project root

## How it works

1. On `session_start`, checks `ctx.cwd/.codegraph/codegraph.db` exists
2. Spawns `codegraph serve --mcp` as a subprocess with `cwd: projectRoot`
3. Discovers available tools via MCP `tools/list`
4. Registers all tools with `pi.registerTool()`
5. Injects usage instructions into system prompt via `before_agent_start`
6. On `session_shutdown` or process exit, cleans up all MCP clients
