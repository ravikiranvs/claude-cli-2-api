import type { Config } from "../src/config.js";

export function makeTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    gatewayPort: 3000,
    adminPort: 3001,
    host: "127.0.0.1",
    databasePath: ":memory:",
    uploadsDir: "./data/test-uploads",
    claudeSubprocessStub: true,
    adminUsername: "admin",
    adminPassword: "hunter2",
    adminSessionSecret: "test-secret",
    ...overrides,
  };
}
