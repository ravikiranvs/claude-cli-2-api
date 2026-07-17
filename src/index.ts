import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildAdminServer } from "./admin/server.js";
import { loadConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { buildGatewayServer } from "./gateway/server.js";

export interface RunningServers {
  gateway: FastifyInstance;
  admin: FastifyInstance;
  gatewayAddress: string;
  adminAddress: string;
}

export async function start(env: Partial<Record<string, string>>): Promise<RunningServers> {
  const config = loadConfig(env);

  migrate(config.databasePath);

  const gateway = buildGatewayServer();
  const admin = await buildAdminServer(config);

  const gatewayAddress = await gateway.listen({ port: config.gatewayPort, host: "127.0.0.1" });
  const adminAddress = await admin.listen({ port: config.adminPort, host: "127.0.0.1" });

  console.log(`Gateway listening at ${gatewayAddress}`);
  console.log(`Admin Console listening at ${adminAddress}`);

  return { gateway, admin, gatewayAddress, adminAddress };
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  start(process.env).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
