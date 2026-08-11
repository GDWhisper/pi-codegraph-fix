# AGENTS.md — pi-codegraph-fix 开发指导

## 这是什么

pi 的扩展插件:把 codegraph 的 MCP 服务接进 pi,懒加载。**所有源码都在 `extensions/index.ts` 一个文件里**(约 360 行),没有其他源码文件,不要到处找。

## 核心架构(改代码前必读)

生命周期:

1. `session_start`:`existsSync(<cwd>/.codegraph/codegraph.db)` 不存在则直接 return(不注册任何工具);存在则注册 **stub 工具**(`STUB_TOOLS`,permissive schema `additionalProperties: true`)——**不 spawn 任何进程**
2. 首次工具调用:stub execute → `callCodegraph` → `ensureTools`(`toolEnsurePromises` 幂等缓存)→ `getClient`(`clientPromises` 缓存)→ `McpClient.start()` spawn `codegraph serve --mcp` → MCP 握手(`initialize` + `notifications/initialized`)→ `tools/list` → 逐个 `pi.registerTool` 注册真实工具
3. 后续调用复用同一 client,不重复 spawn;失败时缓存的 promise 被删除以便下次重试
4. `session_shutdown` / 进程退出 / SIGTERM / SIGHUP:destroy 所有 client(kill 子进程),清空全部缓存

关键不变式:

- **同名 `pi.registerTool` 是替换语义**(pi 的 extension.tools 是 Map)——stub → 真实工具的替换依赖这点,勿改成先 unregister
- 每个项目一个 `McpClient`,按 `ctx.cwd`(不是 `process.cwd()`)区分;并发首调共享同一个 spawn promise

## 已知事实(实测验证,勿臆造)

- codegraph v1.5 的 MCP 服务器 `tools/list` **只广告 `codegraph_explore`**;`codegraph_search` / `codegraph_node` / `codegraph_callers` / `codegraph_callees` / `codegraph_impact` / `codegraph_files` 不被广告但 `tools/call` 接受
- `codegraph_context` **不存在**(服务器返回 "Unknown tool";该字符串在服务器源码里只是 CLI stdout 的 XML 标签)。曾误入 stub 列表,已移除——**不要加回来**
- `STUB_TOOLS` 里的参数提示(`symbol` / `query` / `file, offset, limit` 等)是实测验证过的。新增或改动前,用 `tools/call` 空参数探测(错误信息会暴露期望参数名)或查 `codegraph <cmd> --help`

## 测试

仓库无 node_modules,不能直接 tsc。推荐端到端冒烟:

```bash
# 需要一个带 .codegraph/codegraph.db 的测试项目(如 /tmp/cgtest)
cd <测试项目>
pi -p --no-session -ne -e <repo>/extensions/index.ts -e <spy.ts> "Call codegraph_search (query='foo') and report the result"
```

- `-ne` 隔离全局扩展;spy 是记录事件 + 进程状态的探针扩展
- spy 必须按**父进程 PID**(`pgrep -P process.pid`)过滤 codegraph 进程——机器上常有其他会话的常驻 codegraph 守护进程,全局 pgrep 会误报
- 验证点:session_start 无子进程 → 首次 tool_call 后才出现 → 多次调用同一 PID → session_shutdown 后无残留;`pi.getAllTools()` 快照确认工具面
- 类型检查:临时目录 `npm i typescript` + symlink pi 包、typebox、@types/node 后 `tsc --noEmit --skipLibCheck --strict`

## 发布(npm 与 GitHub Release 同步)

1. bump `package.json` version(如 1.2.0)→ `git commit` + `git push`
2. `npm publish`——registry 由 `publishConfig.registry` 保证走 npmjs;`npm whoami` 判断登录状态需带 `--registry=https://registry.npmjs.org/`(本机 `~/.npmrc` 默认 npmmirror)
3. `git tag -a v1.2.0 -m "..."` + `git push origin v1.2.0`
4. `gh release create v1.2.0 --title "v1.2.0 — ..." --notes "..."`(参考 v1.1.0 / v1.2.0 的中文 notes 格式)

## 边界与坑

- stub 描述里的参数提示是 LLM 首调成功的唯一依据,保持准确;描述会进系统提示,勿写冗长
- 无索引项目:不注册工具,`before_agent_start` 里 `toolsAvailable` 为 false 时直接 return,不注入 CodeGraph 提示
- Windows:`spawn` 用 `shell: true` 且 bin 为 `codegraph.cmd`(保留现有逻辑)
- 不要新增 npm 依赖(peerDependencies 只有 `@earendil-works/pi-coding-agent` 和 `typebox`)
- `.npmrc` 被 `.gitignore` 忽略,本地配置不入库;AGENTS.md 不在 npm `files` 里,只随仓库分发
