# pi-codegraph-fix

[CodeGraph](https://colbymchenry.github.io/codegraph/) MCP sidecar 插件，用于 [pi coding agent](https://github.com/earendil-works/pi)。

[English](README.md)

修复了导致 codegraph 调用率低的根本问题：**`process.cwd()` 锁定**。

## 修复了什么

[colbymchenry/codegraph-pi](https://github.com/colbymchenry/codegraph-pi) 和 [SeanPedersen/pi-codegraph](https://github.com/SeanPedersen/pi-codegraph) 都使用 `process.cwd()` 来定位 `.codegraph/codegraph.db`：

```typescript
const dbPath = join(process.cwd(), ".codegraph", "codegraph.db");
//                ^^^^^^^^^^^^^
//                始终指向 pi 进程启动目录，而不是当前 session 的工作目录
```

当你用 `pi session=<id>` 加载其他项目的会话，或者 `pi` 是从 `~` 而非项目根目录启动时，DB 文件永远不会被找到 → codegraph 工具无法注册 → 调用率 0%。

**修复：** 使用 `session_start` 事件中的 `ctx.cwd`：

```typescript
const projectRoot = ctx.cwd || process.cwd();
//                ^^^^^^^
//                当前 session 的工作目录，由 pi 提供
```

同时：`spawn("codegraph serve --mcp")` 传入 `cwd: projectRoot`，确保子进程也看到正确的项目根。

## 为什么清理很重要

缺少生命周期管理时，`codegraph serve --mcp` 进程会像僵尸一样累积：

```
pi 启动 → 启动 codegraph serve --mcp (PID A)
pi 退出 → PID A 未被 kill → 僵尸
pi 启动 → 启动 codegraph serve --mcp (PID B)
pi 退出 → PID B 未被 kill → 僵尸
...
→ 12+ 个进程争抢 daemon 锁
→ daemon socket 竞争 → "server disconnected" 错误
```

**根因：** 原版 `codegraph-pi` 和 `pi-codegraph` 均缺少进程清理——MCP server 子进程被启动但从未在 session 退出时被 kill。

**修复：** 三路径清理确保零残留：

| 路径 | 触发时机 | 效果 |
|------|----------|------|
| `session_shutdown` | pi 正常退出 | `destroy()` 所有客户端 |
| `process.once("exit")` | Node 进程退出 | `destroy()` 所有客户端 |
| `SIGTERM` / `SIGHUP` | 终端关闭、kill 信号 | `destroy()` 后重新抛出信号 |

实测验证：在 12 个僵尸进程累积超过 9 小时、跨越 6 个 session 的系统上，切换至 `pi-codegraph-fix` 并重启后，一个 session 生命周期内即可消除所有僵尸。

## 特性一览

| 特性 | 来源 |
|------|------|
| `ctx.cwd` 替代 `process.cwd()` | **pi-codegraph-fix** |
| `spawn` 指定 `cwd` | **pi-codegraph-fix** |
| 多项目 MCP 客户端（每个 CWD 独立） | SeanPedersen/pi-codegraph |
| 动态工具发现（MCP `tools/list`） | SeanPedersen/pi-codegraph |
| 进程清理钩子（exit, SIGTERM, SIGHUP） | SeanPedersen/pi-codegraph |
| 单一文件，无外部依赖 | SeanPedersen/pi-codegraph |
| `before_agent_start` 注入 system prompt（无 APPEND_SYSTEM.md 副作用） | colbymchenry/codegraph-pi |
| `.codegraph/codegraph.db` 精确检查（而非仅检查目录存在） | colbymchenry/codegraph-pi |

## 安装

```bash
# 通过 pi install（从 GitHub）
pi install github:GDWhisper/pi-codegraph-fix

# 或添加到 settings.json
```

```json
{
  "packages": ["github:GDWhisper/pi-codegraph-fix"]
}
```

## 依赖

- [CodeGraph](https://colbymchenry.github.io/codegraph/) CLI（`npm install -g @colbymchenry/codegraph`）
- 项目需已建立索引：项目根目录执行 `codegraph init`

## 工作原理

1. `session_start` 时检查 `ctx.cwd/.codegraph/codegraph.db` 是否存在
2. 以 `cwd: projectRoot` 启动 `codegraph serve --mcp` 子进程
3. 通过 MCP `tools/list` 动态发现可用工具
4. 全部注册为 pi 工具（`pi.registerTool()`）
5. 通过 `before_agent_start` 将使用说明注入 system prompt
6. `session_shutdown` 或进程退出时清理所有 MCP 客户端

## 致谢

- [colbymchenry/codegraph-pi](https://github.com/colbymchenry/codegraph-pi) — 原始 pi 扩展
- [SeanPedersen/pi-codegraph](https://github.com/SeanPedersen/pi-codegraph) — 多客户端架构
