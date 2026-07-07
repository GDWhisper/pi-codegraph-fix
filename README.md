# pi-codegraph-fix

[![npm](https://img.shields.io/npm/v/pi-codegraph-fix)](https://www.npmjs.com/package/pi-codegraph-fix)

The CodeGraph plugin for pi that actually works.

[中文版](README.zh.md)

---

## Features

- **Switch projects freely** — uses `ctx.cwd` instead of `process.cwd()`, no more silent tool loss when you change projects
- **Zero zombie processes** — cleanup on session shutdown, process exit, and SIGTERM/SIGHUP. No more pile-up
- **Lazy start** — spawns codegraph only when you first use it, doesn't slow down session launch
- **Multi-project friendly** — each project gets its own MCP client, switches automatically
- **No misleading hints** — injects CodeGraph instructions only when tools are actually ready

## Quick Install

```bash
pi install npm:pi-codegraph-fix
```

You also need CodeGraph CLI (`npm install -g @colbymchenry/codegraph`) and your project indexed (`codegraph init`).

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

**`ctx.cwd` instead of `process.cwd()`** — reads the current session's working directory from pi, so it works no matter where or how you launched pi.

**Three-path cleanup** — kills the MCP subprocess on normal exit, crash, or terminal close:

| Path | When |
|------|------|
| `session_shutdown` | pi exits normally |
| `process.once("exit")` | Node process ends |
| `SIGTERM` / `SIGHUP` | Terminal close, kill |

No more zombies. No more "server disconnected".

## How It Works

1. On `session_start`, check if `ctx.cwd/.codegraph/codegraph.db` exists (instant file check)
2. On first codegraph tool call, spawn `codegraph serve --mcp` in background (lazy, doesn't block session)
3. Discover available tools via MCP `tools/list` protocol
4. Register all tools with `pi.registerTool()`
5. Inject usage instructions into system prompt via `before_agent_start` after tools are ready
6. On `session_shutdown` or process exit, clean up all MCP clients

---

## Changes from Upstream

This fork builds on two earlier projects. Both had the same core bug: using `process.cwd()` breaks when switching projects, and neither cleaned up their child processes properly.

### Bug fixes

| Bug | Upstream source | Fix in this fork |
|-----|----------------|------------------|
| Tools disappear when switching projects | Both codegraph-pi & pi-codegraph used `process.cwd()` — always points to pi's launch dir, not the current session | `ctx.cwd` reads the actual session working directory from pi |
| Child process not in right directory | Same root cause — codegraph runs in wrong CWD | `spawn` with explicit `cwd: projectRoot` |
| Zombie processes on exit | codegraph-pi had no cleanup at all; pi-codegraph's cleanup was incomplete | Three-path cleanup: `session_shutdown`, `process.once("exit")`, `SIGTERM`/`SIGHUP` |
| LLM tries to use codegraph tools when there's no index | codegraph-pi injected system prompt unconditionally | Only inject usage hints after tools are actually ready |

### Optimizations (new in this fork)

| Optimization | Why |
|-------------|-----|
| Lazy connect | Spawns codegraph on first tool use instead of at session start — faster launch |
| Smart prompt injection | Waits for tools to register before telling the LLM about them — no misleading hints |

### Inherited features

| Feature | From |
|---------|------|
| Dynamic tool discovery via MCP `tools/list` | [SeanPedersen/pi-codegraph](https://github.com/SeanPedersen/pi-codegraph) |
| Multi-project MCP clients (one per CWD) | SeanPedersen/pi-codegraph |
| Self-contained single file | SeanPedersen/pi-codegraph |
| `before_agent_start` system prompt injection | [nosuiyi/codegraph-pi](https://github.com/nosuiyi/codegraph-pi) |
| `.codegraph/codegraph.db` exact check | nosuiyi/codegraph-pi |

## Credits

- [nosuiyi/codegraph-pi](https://github.com/nosuiyi/codegraph-pi) — original pi extension
- [SeanPedersen/pi-codegraph](https://github.com/SeanPedersen/pi-codegraph) — multi-client architecture
