export interface Config {
  gatewayPort: number;
  adminPort: number;
  host: string;
  databasePath: string;
  uploadsDir: string;
  claudeSubprocessStub: boolean;
  adminUsername: string;
  adminPassword: string;
  adminSessionSecret: string;
}

export function loadConfig(env: Partial<Record<string, string>>): Config {
  return {
    gatewayPort: Number(env.GATEWAY_PORT ?? 3000),
    adminPort: Number(env.ADMIN_PORT ?? 3001),
    // Defaults to all interfaces, not loopback, so the ports are reachable from outside a Docker container.
    host: env.HOST ?? "0.0.0.0",
    databasePath: env.DATABASE_PATH ?? "./data/gateway.db",
    uploadsDir: env.UPLOADS_DIR ?? "./data/uploads",
    claudeSubprocessStub: env.CLAUDE_SUBPROCESS_STUB === "1",
    adminUsername: env.ADMIN_USERNAME ?? "",
    adminPassword: env.ADMIN_PASSWORD ?? "",
    adminSessionSecret: env.ADMIN_SECRET ?? env.ADMIN_PASSWORD ?? "",
  };
}
