# pi-codegraph-fix

[![npm](https://img.shields.io/npm/v/pi-codegraph-fix)](https://www.npmjs.com/package/pi-codegraph-fix)

能正常工作的 CodeGraph pi 插件。

[English](README.md)

---

## 特性

- **跨项目不失效** — 用 `ctx.cwd` 而非 `process.cwd()`，切项目不丢 codegraph 工具
- **零僵尸进程** — session_shutdown + exit + SIGTERM/SIGHUP 三路清理
- **懒加载启动** — MCP 进程在首次使用时后台启动，`session_start` 不阻塞
- **多项目支持** — 每个项目独立 MCP 连接，跨项目 session 自动切换
- **智能提示注入** — 工具就绪后才注入 CodeGraph 使用说明，无索引不误导

## 快速安装

```bash
pi install npm:pi-codegraph-fix
```

需要 CodeGraph CLI（`npm install -g @colbymchenry/codegraph`）和项目索引（`codegraph init`）。

---

## 它解决了什么

### 1. 切换项目后 codegraph 工具就消失了

你用 `pi session=<其他项目>` 或者从 `~` 目录启动 pi，codegraph 工具就没了。没有报错，就是不存在。

**原因：** 原版用 `process.cwd()` 找 `.codegraph/codegraph.db`。这个路径永远指向 pi 第一次启动的目录，而不是你当前 session 的项目目录。找错目录 → 找不到 DB → 工具消失 → 静默失败。

### 2. 僵尸进程越堆越多

每次关闭 pi，`codegraph serve --mcp` 子进程都不会自己死掉。几次 session 下来就堆了十几个，互相抢 socket 锁——每次调用 codegraph 工具都可能弹 "server disconnected"。

真实案例：12 个僵尸进程，跨越 6 个 session，累积 9 小时以上。每次 codegraph 调用都在赌运气看哪个僵尸抢到了锁。

---

## 怎么修的

相比原版（[codegraph-pi](https://github.com/colbymchenry/codegraph-pi)、[pi-codegraph](https://github.com/SeanPedersen/pi-codegraph)），改了两处：

**`ctx.cwd` 替代 `process.cwd()`** — 从 pi 获取当前 session 的工作目录，不管你怎么启动、在哪启动都能找到正确项目。

**三路径清理** — 正常退出、进程崩溃、终端关闭都会杀掉 MCP 子进程：

| 路径 | 触发时机 |
|------|----------|
| `session_shutdown` | pi 正常退出 |
| `process.once("exit")` | Node 进程结束 |
| `SIGTERM` / `SIGHUP` | 终端关闭、被 kill |

没有僵尸，没有断连报错。

---

## 特性一览

| 特性 | 来源 |
|------|------|
| `ctx.cwd` 替代 `process.cwd()` | **pi-codegraph-fix** |
| `spawn` 指定 `cwd` | **pi-codegraph-fix** |
| 多项目 MCP 客户端（每个 CWD 独立） | SeanPedersen/pi-codegraph |
| 动态工具发现（MCP `tools/list`） | SeanPedersen/pi-codegraph |
| 进程清理钩子（exit, SIGTERM, SIGHUP） | SeanPedersen/pi-codegraph |
| 单一文件，无外部依赖 | SeanPedersen/pi-codegraph |
| `before_agent_start` 注入 system prompt | colbymchenry/codegraph-pi |
| `.codegraph/codegraph.db` 精确检查 | colbymchenry/codegraph-pi |

## 工作原理

1. `session_start` 时检查 `ctx.cwd/.codegraph/codegraph.db` 是否存在（瞬时操作）
2. 首次调用 codegraph 工具时后台启动 `codegraph serve --mcp`（懒加载，不阻塞 session）
3. 工具就绪后通过 `pi.registerTool()` 动态注册所有 MCP 工具
4. 注册完成后通过 `before_agent_start` 注入 CodeGraph 使用说明
5. `session_shutdown` 或进程退出时清理所有 MCP 客户端

## 致谢

- [colbymchenry/codegraph-pi](https://github.com/colbymchenry/codegraph-pi) — 原始 pi 扩展
- [SeanPedersen/pi-codegraph](https://github.com/SeanPedersen/pi-codegraph) — 多客户端架构
