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

  it("reads the admin credentials from the environment", () => {
    const config = loadConfig({ ADMIN_USERNAME: "admin", ADMIN_PASSWORD: "hunter2" });

    expect(config.adminUsername).toBe("admin");
    expect(config.adminPassword).toBe("hunter2");
  });

  it("derives the session secret from ADMIN_SECRET when set", () => {
    const config = loadConfig({ ADMIN_PASSWORD: "hunter2", ADMIN_SECRET: "a-separate-secret" });

    expect(config.adminSessionSecret).toBe("a-separate-secret");
  });

  it("falls back to ADMIN_PASSWORD for the session secret when ADMIN_SECRET is unset", () => {
    const config = loadConfig({ ADMIN_PASSWORD: "hunter2" });

    expect(config.adminSessionSecret).toBe("hunter2");
  });

  it("reads the uploads directory from the environment", () => {
    const config = loadConfig({ UPLOADS_DIR: "/data/my-uploads" });

    expect(config.uploadsDir).toBe("/data/my-uploads");
  });

  it("falls back to a default uploads directory when unset", () => {
    const config = loadConfig({});

    expect(config.uploadsDir).toBe("./data/uploads");
  });
});
