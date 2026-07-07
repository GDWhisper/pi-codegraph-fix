# pi-codegraph-fix

[![npm](https://img.shields.io/npm/v/pi-codegraph-fix)](https://www.npmjs.com/package/pi-codegraph-fix)

能正常工作的 CodeGraph pi 插件。

[English](README.md)

---

## 特性

- **跨项目不失效** — 用 `ctx.cwd` 而非 `process.cwd()`，切项目不丢 codegraph 工具
- **零僵尸进程** — 会话关闭/进程退出/终止信号三路清理，不留后患
- **懒加载启动** — 首次调用工具时才启动 codegraph 进程，不拖慢会话启动
- **多项目支持** — 每个项目独立 MCP 连接，跨项目会话自动切换
- **智能提示注入** — 工具就绪后才注入使用说明，无索引不误导

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

**`ctx.cwd` 替代 `process.cwd()`** — 从 pi 获取当前 session 的工作目录，不管你怎么启动、在哪启动都能找到正确项目。

**三路清理** — 正常退出、进程崩溃、终端关闭都会杀掉 MCP 子进程：

| 路径 | 触发时机 |
|------|----------|
| `session_shutdown` | pi 正常退出 |
| `process.once("exit")` | Node 进程结束 |
| `SIGTERM` / `SIGHUP` | 终端关闭、被 kill |

没有僵尸，没有断连报错。

## 工作原理

1. 会话启动时检查当前项目是否存在 codegraph 索引（仅一次文件检查）
2. 首次调用 codegraph 工具时后台启动 `codegraph serve --mcp`（懒加载，不阻塞）
3. 通过 MCP `tools/list` 协议动态发现可用工具
4. 注册为 pi 原生工具
5. 工具就绪后注入使用说明到系统提示
6. 会话关闭或进程退出时清理所有 MCP 客户端

---

## 与上游的差异

本项目基于两个早期项目改进。两个上游都有一个相同的核心 bug：用 `process.cwd()` 导致切项目时工具失效，而且都没正确处理子进程清理。

### Bug 修复

| Bug | 上游来源 | 本 fork 修复 |
|-----|---------|-------------|
| 切项目后工具消失 | codegraph-pi 和 pi-codegraph 都用 `process.cwd()`——永远指向 pi 启动目录而非当前会话 | `ctx.cwd` 从 pi 读取当前会话的真实工作目录 |
| 子进程跑错目录 | 同一个根因——codegraph 在错误目录启动 | `spawn` 指定 `cwd: projectRoot` |
| 退出后残留僵尸进程 | codegraph-pi 完全没有清理；pi-codegraph 清理不完整 | 三路清理：`session_shutdown`、`process.once("exit")`、`SIGTERM`/`SIGHUP` |
| 无索引时 LLM 仍被告知使用 codegraph | codegraph-pi 无条件注入系统提示 | 工具就绪后才注入使用说明 |

### 新增优化

| 优化 | 作用 |
|------|------|
| 懒加载连接 | 首次使用才启动 codegraph，不拖慢会话启动 |
| 智能提示注入 | 等待工具注册后再告知 LLM——不会误导 |

### 继承的特性

| 特性 | 来源 |
|------|------|
| 通过 MCP `tools/list` 动态发现工具 | [SeanPedersen/pi-codegraph](https://github.com/SeanPedersen/pi-codegraph) |
| 多项目 MCP 客户端（每项目独立连接） | SeanPedersen/pi-codegraph |
| 单文件无外部依赖 | SeanPedersen/pi-codegraph |
| `before_agent_start` 系统提示注入 | [nosuiyi/codegraph-pi](https://github.com/nosuiyi/codegraph-pi) |
| `.codegraph/codegraph.db` 精确检查 | nosuiyi/codegraph-pi |

## 致谢

- [nosuiyi/codegraph-pi](https://github.com/nosuiyi/codegraph-pi) — 原始 pi 扩展
- [SeanPedersen/pi-codegraph](https://github.com/SeanPedersen/pi-codegraph) — 多客户端架构
