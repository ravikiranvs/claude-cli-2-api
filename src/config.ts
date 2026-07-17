export interface Config {
  gatewayPort: number;
  adminPort: number;
  databasePath: string;
  claudeSubprocessStub: boolean;
}

export function loadConfig(env: Partial<Record<string, string>>): Config {
  return {
    gatewayPort: Number(env.GATEWAY_PORT ?? 3000),
    adminPort: Number(env.ADMIN_PORT ?? 3001),
    databasePath: env.DATABASE_PATH ?? "./data/gateway.db",
    claudeSubprocessStub: env.CLAUDE_SUBPROCESS_STUB === "1",
  };
}
