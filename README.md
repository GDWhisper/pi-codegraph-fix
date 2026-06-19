# pi-codegraph-fix

[CodeGraph](https://colbymchenry.github.io/codegraph/) MCP sidecar for the [pi coding agent](https://github.com/earendil-works/pi).

Fixes the core problem that caused low codegraph adoption: **`process.cwd()` lock-in**.

## The Fix

Both [colbymchenry/codegraph-pi](https://github.com/colbymchenry/codegraph-pi) and [SeanPedersen/pi-codegraph](https://github.com/SeanPedersen/pi-codegraph) used `process.cwd()` to locate `.codegraph/codegraph.db`:

```typescript
const dbPath = join(process.cwd(), ".codegraph", "codegraph.db");
//                ^^^^^^^^^^^^^
//                always points to where pi was launched, not the current session
```

When you loaded a session from a different project (`pi session=<id>`), or when `pi` was launched from `~` instead of the project root, the DB file was never found → no codegraph tools were registered → 0% call rate.

**Fix:** Use `ctx.cwd` from the `session_start` event:

```typescript
const projectRoot = ctx.cwd || process.cwd();
//                ^^^^^^^
//                the current session's working directory, provided by pi
```

Plus: pass `cwd: projectRoot` when spawning `codegraph serve --mcp` so the subprocess also resolves the correct project root.

## Features

| Feature | Source |
|---------|--------|
| `ctx.cwd` instead of `process.cwd()` | **pi-codegraph-fix** |
| `spawn` with explicit `cwd` | **pi-codegraph-fix** |
| Multi-project MCP clients (one per CWD) | SeanPedersen/pi-codegraph |
| Dynamic tool discovery via MCP `tools/list` | SeanPedersen/pi-codegraph |
| Process cleanup hooks (exit, SIGTERM, SIGHUP) | SeanPedersen/pi-codegraph |
| Self-contained single file | SeanPedersen/pi-codegraph |
| `before_agent_start` system prompt injection (no APPEND_SYSTEM.md side effect) | colbymchenry/codegraph-pi |
| `.codegraph/codegraph.db` exact check (not just `.codegraph/` dir) | colbymchenry/codegraph-pi |

## Install

```bash
# pi install (from GitHub)
pi install github:GDWhisper/pi-codegraph-fix

# Or via settings.json
```

```json
{
  "packages": ["github:GDWhisper/pi-codegraph-fix"]
}
```

[中文版](README.zh.md)

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

## Credits

- [colbymchenry/codegraph-pi](https://github.com/colbymchenry/codegraph-pi) — original pi extension
- [SeanPedersen/pi-codegraph](https://github.com/SeanPedersen/pi-codegraph) — multi-client architecture
