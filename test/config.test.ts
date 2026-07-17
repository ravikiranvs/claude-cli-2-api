import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("reads the Gateway and Admin Console ports from the environment", () => {
    const config = loadConfig({ GATEWAY_PORT: "4100", ADMIN_PORT: "4101" });

    expect(config.gatewayPort).toBe(4100);
    expect(config.adminPort).toBe(4101);
  });

  it("falls back to default ports when the environment variables are unset", () => {
    const config = loadConfig({});

    expect(config.gatewayPort).toBe(3000);
    expect(config.adminPort).toBe(3001);
  });
});
