# pi-codegraph-fix

[![npm](https://img.shields.io/npm/v/pi-codegraph-fix)](https://www.npmjs.com/package/pi-codegraph-fix)

The CodeGraph plugin for pi that actually works.

[中文版](README.zh.md)

---

## Features

- **跨项目不失效** — 用 `ctx.cwd` 而非 `process.cwd()`，切项目不丢 codegraph 工具
- **零僵尸进程** — session_shutdown + exit + SIGTERM/SIGHUP 三路清理
- **懒加载启动** — MCP 进程在首次使用时后台启动，`session_start` 不阻塞
- **多项目支持** — 每个项目独立 MCP 连接，跨项目 session 自动切换
- **智能提示注入** — 工具就绪后才注入 CodeGraph 使用说明，无索引不误导

## Quick Install

```bash
pi install npm:pi-codegraph-fix
```

需要 CodeGraph CLI（`npm install -g @colbymchenry/codegraph`）和项目索引（`codegraph init`）。

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

1. `session_start` 时检查 `ctx.cwd/.codegraph/codegraph.db` 是否存在（瞬时操作）
2. 首次调用 codegraph 工具时后台启动 `codegraph serve --mcp`（懒加载，不阻塞 session）
3. 工具就绪后通过 `pi.registerTool()` 动态注册所有 MCP 工具
4. 注册完成后通过 `before_agent_start` 注入 CodeGraph 使用说明
5. `session_shutdown` 或进程退出时清理所有 MCP 客户端

## Credits

- [colbymchenry/codegraph-pi](https://github.com/colbymchenry/codegraph-pi) — original pi extension
- [SeanPedersen/pi-codegraph](https://github.com/SeanPedersen/pi-codegraph) — multi-client architecture
