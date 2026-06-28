# pi-codegraph-fix

The CodeGraph plugin for pi that actually works.

[中文版](README.zh.md)

---

**Two problems, one fix.** Original CodeGraph plugins for pi break silently when you switch projects, and leave zombie processes piling up. This fork fixes both.

## Quick Install

```bash
pi install npm:pi-codegraph-fix
```

That's it. You also need CodeGraph CLI (`npm install -g @colbymchenry/codegraph`) and your project indexed (`codegraph init`).

---

## The Problems

### 1. CodeGraph goes silent when you switch projects

You `pi session=<other-project>` or launch pi from `~` instead of your project root. Suddenly codegraph tools disappear. No error, just nothing.

**Why:** The original plugin used `process.cwd()` to find `.codegraph/codegraph.db`. That always points to wherever pi was first launched — not your current session's project. Wrong project → no DB → no tools → silent failure.

### 2. Zombie process pile-up

Every time you close pi, the `codegraph serve --mcp` subprocess doesn't die. After a few sessions you have a dozen of them fighting over the same socket — causing "server disconnected" errors on every codegraph call.

Real case: 12 zombie processes accumulated over 9 hours across 6 sessions. Every codegraph call spun the roulette wheel on which zombie had the socket lock.

---

## The Fix

Two changes from the originals ([codegraph-pi](https://github.com/colbymchenry/codegraph-pi), [pi-codegraph](https://github.com/SeanPedersen/pi-codegraph)):

**`ctx.cwd` instead of `process.cwd()`** — reads the current session's working directory from pi, so it works no matter where or how you launched pi.

**Three-path cleanup** — kills the MCP subprocess on normal exit, crash, or terminal close:

| Path | When | 
|------|------|
| `session_shutdown` | pi exits normally |
| `process.once("exit")` | Node process ends |
| `SIGTERM` / `SIGHUP` | Terminal close, kill |

No more zombies. No more "server disconnected".

---

## Features

| Feature | Source |
|---------|--------|
| `ctx.cwd` instead of `process.cwd()` | **pi-codegraph-fix** |
| `spawn` with explicit `cwd` | **pi-codegraph-fix** |
| Multi-project MCP clients (one per CWD) | SeanPedersen/pi-codegraph |
| Dynamic tool discovery via MCP `tools/list` | SeanPedersen/pi-codegraph |
| Process cleanup hooks (exit, SIGTERM, SIGHUP) | SeanPedersen/pi-codegraph |
| Self-contained single file | SeanPedersen/pi-codegraph |
| `before_agent_start` system prompt injection | colbymchenry/codegraph-pi |
| `.codegraph/codegraph.db` exact check | colbymchenry/codegraph-pi |

## How It Works

1. On `session_start`, checks `ctx.cwd/.codegraph/codegraph.db` exists
2. Spawns `codegraph serve --mcp` with `cwd: projectRoot`
3. Discovers available tools via MCP `tools/list`
4. Registers all tools with `pi.registerTool()`
5. Injects usage instructions into system prompt via `before_agent_start`
6. On `session_shutdown` or process exit, cleans up all MCP clients

## Credits

- [colbymchenry/codegraph-pi](https://github.com/colbymchenry/codegraph-pi) — original pi extension
- [SeanPedersen/pi-codegraph](https://github.com/SeanPedersen/pi-codegraph) — multi-client architecture
