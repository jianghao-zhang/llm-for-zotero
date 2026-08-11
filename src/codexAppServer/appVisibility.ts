type CodexAppVisibilityHooks = {
  codexHome?: string;
  homeDir?: string;
  writeFrame?: (socketPath: string, frame: Uint8Array) => void | Promise<void>;
};

function getToolkitGlobal<T>(name: string): T | undefined {
  try {
    return ztoolkit.getGlobal(name) as T;
  } catch {
    return undefined;
  }
}

function normalizePath(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

function resolveCodexHomeFromRuntime(): string {
  const services =
    (globalThis as unknown as { Services?: typeof Services }).Services ||
    getToolkitGlobal<typeof Services>("Services");
  const configured = normalizePath(services?.env?.get?.("CODEX_HOME"));
  if (configured) return configured;

  const pathUtils =
    (globalThis as unknown as { PathUtils?: { homeDir?: string } }).PathUtils ||
    getToolkitGlobal<{ homeDir?: string }>("PathUtils");
  const homeDir =
    normalizePath(pathUtils?.homeDir) ||
    normalizePath(services?.dirsvc?.get?.("Home", Ci.nsIFile)?.path);
  return homeDir ? `${homeDir}/.codex` : "";
}

export function resolveCodexAppIpcSocketPath(
  hooks: Pick<CodexAppVisibilityHooks, "codexHome" | "homeDir"> = {},
): string | null {
  const codexHome = normalizePath(hooks.codexHome);
  if (codexHome) return `${codexHome}/ipc/ipc.sock`;
  const homeDir = normalizePath(hooks.homeDir);
  if (homeDir) return `${homeDir}/.codex/ipc/ipc.sock`;
  const runtimeHome = resolveCodexHomeFromRuntime();
  return runtimeHome ? `${runtimeHome}/ipc/ipc.sock` : null;
}

export function buildCodexAppTasksReloadFrame(): Uint8Array {
  const payload = new TextEncoder().encode(
    JSON.stringify({
      type: "broadcast",
      method: "query-cache-invalidate",
      sourceClientId: "llm-for-zotero",
      version: 0,
      params: { queryKey: ["tasks"] },
    }),
  );
  const frame = new Uint8Array(4 + payload.length);
  new DataView(frame.buffer).setUint32(0, payload.length, true);
  frame.set(payload, 4);
  return frame;
}

function writeUnixSocketFrame(socketPath: string, frame: Uint8Array): void {
  const services =
    (globalThis as unknown as { Services?: typeof Services }).Services ||
    getToolkitGlobal<typeof Services>("Services");
  if (services?.appinfo?.OS !== "Darwin") {
    throw new Error("Codex App background refresh is only supported on macOS");
  }

  const socketFile = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  socketFile.initWithPath(socketPath);
  const socketService = Cc[
    "@mozilla.org/network/socket-transport-service;1"
  ].getService(Ci.nsISocketTransportService);
  const transport = socketService.createUnixDomainTransport(socketFile);
  const output = transport.openOutputStream(
    Ci.nsITransport.OPEN_BLOCKING ?? 0,
    0,
    0,
  );
  try {
    const binary = String.fromCharCode(...frame);
    let offset = 0;
    while (offset < binary.length) {
      const written =
        output.write(binary.slice(offset), binary.length - offset) || 0;
      if (written <= 0)
        throw new Error("Codex App IPC socket accepted no data");
      offset += written;
    }
  } finally {
    output.close();
  }
}

/** Refreshes the Codex App task catalog without activating or navigating the app. */
export async function notifyCodexAppTasksChanged(
  hooks: CodexAppVisibilityHooks = {},
): Promise<boolean> {
  const socketPath = resolveCodexAppIpcSocketPath(hooks);
  if (!socketPath) return false;
  const frame = buildCodexAppTasksReloadFrame();
  await (hooks.writeFrame || writeUnixSocketFrame)(socketPath, frame);
  return true;
}
