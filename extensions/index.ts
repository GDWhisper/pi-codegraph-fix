/**
 * pi-codegraph-fix — CodeGraph MCP bridge for pi
 *
 * Combines the best of:
 *   - colbymchenry/codegraph-pi  (structure, our ctx.cwd fix)
 *   - SeanPedersen/pi-codegraph   (multi-project clients, dynamic tools, cleanup)
 *
 * Key fix: uses ctx.cwd instead of process.cwd() so codegraph tools are
 * registered regardless of where pi was launched — dramatically improving
 * call rate when loading sessions from different projects.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ── Constants ──────────────────────────────────────────────────────────

const TIMEOUT_MS = 60_000;
const SYSTEM_PROMPT_SECTION = `
## CodeGraph

This project has a \`.codegraph/\` index — a SQLite knowledge graph of every
symbol, edge, and file. Prefer codegraph tools over Read/Grep for source code.

| Instead of              | Use                                         |
|-------------------------|---------------------------------------------|
| \`read\` a source file   | \`codegraph_node\` (file mode — serves from index) |
| \`grep\` for symbols     | \`codegraph_search\`                         |
| Exploring an area       | \`codegraph_explore\`                        |
| Finding callers         | \`codegraph_callers\` / \`codegraph_callees\`  |
| Impact analysis         | \`codegraph_impact\`                         |
| File structure overview | \`codegraph_context\` / \`codegraph_files\`    |

Use \`codegraph_explore\` first for almost any code question — it returns
verbatim source + call paths in one call.
`;

// ── MCP Client ───────────────────────────────────────────────────────

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
};

class McpClient {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private destroyed = false;
  private _ready: Promise<void>;

  constructor() {
    this._ready = new Promise(() => {}); // placeholder
  }

  async start(cwd: string): Promise<void> {
    if (this.proc) return;

    const bin = process.platform === "win32" ? "codegraph.cmd" : "codegraph";
    this.proc = spawn(bin, ["serve", "--mcp"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
      cwd,
    });

    this._ready = new Promise((resolve, reject) => {
      const onError = (err: Error) => { cleanup(); reject(err); };
      const onExit = (code: number | null) => {
        if (code !== 0 && !this.destroyed)
          reject(new Error(`codegraph exited with code ${code}`));
      };
      const cleanup = () => {
        this.proc?.removeListener("error", onError);
        this.proc?.removeListener("exit", onExit);
      };

      this.proc!.on("error", onError);
      this.proc!.on("exit", onExit);

      // Handshake
      this.call("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "pi-codegraph-fix", version: "1.0.0" },
      }).then((result) => {
        const r = result as { instructions?: string };
        // Inject server instructions if provided
        cleanup();
        // Send initialized notification (fire-and-forget)
        this._send({ jsonrpc: "2.0", method: "notifications/initialized" });
        resolve();
      }).catch(reject);
    });

    // stdout reader
    this.rl = createInterface({ input: this.proc.stdout! });
    this.rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg: JsonRpcResponse = JSON.parse(trimmed);
        if (msg.id == null) return;
        const p = this.pending.get(msg.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      } catch { /* ignore non-JSON lines */ }
    });

    // stderr for diagnostics
    this.proc.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) console.error("[codegraph]", text);
    });

    // Clean up pending on exit
    this.proc.on("exit", () => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("codegraph process exited"));
      }
      this.pending.clear();
    });

    await this._ready;
  }

  async call(method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc || this.destroyed) {
        return reject(new Error("MCP client not available"));
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP timeout (${TIMEOUT_MS}ms): ${method}`));
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this._send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async listTools(): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
    try {
      const result = await this.call("tools/list", {}) as { tools: Array<{ name: string; description: string; inputSchema: unknown }> };
      return result.tools ?? [];
    } catch {
      return [];
    }
  }

  private _send(msg: unknown): void {
    if (!this.proc?.stdin) return;
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("MCP client destroyed"));
    }
    this.pending.clear();
    this.rl?.close();
    if (this.proc) {
      this.proc.removeAllListeners();
      this.proc.kill();
      this.proc = null;
    }
  }
}

// ── Process cleanup (covers exit, SIGTERM, SIGHUP) ──────────────────

let cleanupHooked = false;
function ensureCleanup(clients: Map<string, McpClient>): void {
  if (cleanupHooked) return;
  cleanupHooked = true;
  const killAll = () => {
    for (const c of clients.values()) c.destroy();
    clients.clear();
  };
  process.once("exit", killAll);
  for (const sig of ["SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => { killAll(); process.kill(process.pid, sig); });
  }
}

// ── Extension entry ─────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Map of project root → MCP client (supports multi-project sessions)
  const clients = new Map<string, McpClient>();
  let projectReady = false;

  pi.on("session_start", async (_event, ctx) => {
    const projectRoot = ctx.cwd || process.cwd();
    const dbPath = join(projectRoot, ".codegraph", "codegraph.db");

    // Reset for each new session
    projectReady = false;

    if (!existsSync(dbPath)) return; // no index → no tools

    // Already connected for this project — mark ready and skip
    if (clients.has(projectRoot)) {
      projectReady = true;
      return;
    }

    const client = new McpClient();

    // Fire-and-forget: lazy connect — don't block session_start
    client.start(projectRoot).then(async () => {
      clients.set(projectRoot, client);
      ensureCleanup(clients);

      // Discover all codegraph MCP tools dynamically
      const tools = await client.listTools();
      for (const tool of tools) {
        pi.registerTool({
          name: tool.name,
          label: tool.name.replace(/^codegraph_/, "").replace(/_/g, " "),
          description: tool.description,
          parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema as Record<string, unknown>),
          execute: async (_id, params) => {
            try {
              const text = await client.call("tools/call", {
                name: tool.name,
                arguments: params,
              });
              const content = typeof text === "string" ? text : JSON.stringify(text, null, 2);
              return { content: [{ type: "text" as const, text: content }], details: {} };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return { content: [{ type: "text" as const, text: `codegraph error: ${msg}` }], details: {}, isError: true };
            }
          },
        });
      }

      projectReady = true;
    }).catch(() => {
      // MCP handshake failed — silently skip (no tools, no prompt injection)
    });
  });

  pi.on("session_shutdown", () => {
    for (const c of clients.values()) c.destroy();
    clients.clear();
    projectReady = false;
  });

  pi.on("before_agent_start", (event) => {
    if (!projectReady) return;
    return { systemPrompt: event.systemPrompt + SYSTEM_PROMPT_SECTION };
  });
}
