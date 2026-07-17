import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { start, type RunningServers } from "../src/index.js";

describe("start", () => {
  let servers: RunningServers | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    await servers?.gateway.close();
    await servers?.admin.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    servers = undefined;
    dir = undefined;
  });

  it("binds the Gateway and Admin Console to the ports given via GATEWAY_PORT/ADMIN_PORT", async () => {
    dir = mkdtempSync(join(tmpdir(), "gateway-start-"));

    servers = await start({
      GATEWAY_PORT: "34561",
      ADMIN_PORT: "34562",
      DATABASE_PATH: join(dir, "gateway.db"),
    });

    expect(servers.gatewayAddress).toBe("http://127.0.0.1:34561");
    expect(servers.adminAddress).toBe("http://127.0.0.1:34562");

    const gatewayHealth = await fetch("http://127.0.0.1:34561/health");
    const adminHealth = await fetch("http://127.0.0.1:34562/health");

    expect(gatewayHealth.status).toBe(200);
    expect(adminHealth.status).toBe(200);
  });
});
