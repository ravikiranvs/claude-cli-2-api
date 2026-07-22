import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiKey, revokeApiKey } from "../src/admin/apiKeys.js";
import { openDatabase } from "../src/db/connection.js";
import { buildGatewayServer } from "../src/gateway/server.js";
import { makeTestConfig } from "./testConfig.js";

describe("Gateway auth + file uploads (integration)", () => {
  let dir: string;
  let databasePath: string;
  let uploadsDir: string;
  let server: FastifyInstance;
  let baseUrl: string;
  let apiKey: string;
  let revokedKey: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "gateway-files-integration-"));
    databasePath = join(dir, "gateway.db");
    uploadsDir = join(dir, "uploads");

    const setupDb = openDatabase(databasePath);
    apiKey = createApiKey(setupDb, "ci-bot", 1000).key;
    const revoked = createApiKey(setupDb, "ex-bot", 1000);
    revokeApiKey(setupDb, revoked.id);
    revokedKey = revoked.key;
    setupDb.close();

    server = buildGatewayServer(makeTestConfig({ databasePath, uploadsDir }));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects an upload with no Gateway API Key with 401", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("hi")], { type: "text/plain" }), "notes.txt");

    const response = await fetch(`${baseUrl}/v1/files`, { method: "POST", body: form });
    expect(response.status).toBe(401);
  });

  it("rejects a revoked Gateway API Key with 401", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("hi")], { type: "text/plain" }), "notes.txt");

    const response = await fetch(`${baseUrl}/v1/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${revokedKey}` },
      body: form,
    });
    expect(response.status).toBe(401);
  });

  it("rejects listing files with no Gateway API Key with 401", async () => {
    const response = await fetch(`${baseUrl}/v1/files`);
    expect(response.status).toBe(401);
  });

  it("rejects deleting a file with no Gateway API Key with 401", async () => {
    const response = await fetch(`${baseUrl}/v1/files/file-does-not-exist`, { method: "DELETE" });
    expect(response.status).toBe(401);
  });

  it("uploads, lists, and deletes a file with a valid Gateway API Key", async () => {
    const form = new FormData();
    form.append("file", new Blob([Buffer.from("hi")], { type: "text/plain" }), "notes.txt");

    const uploadResponse = await fetch(`${baseUrl}/v1/files`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const uploaded = (await uploadResponse.json()) as Record<string, any>;
    expect(uploadResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/v1/files`, { headers: { authorization: `Bearer ${apiKey}` } });
    const listed = (await listResponse.json()) as Record<string, any>;
    expect(listed.data.map((file: any) => file.id)).toContain(uploaded.id);

    const deleteResponse = await fetch(`${baseUrl}/v1/files/${uploaded.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(deleteResponse.status).toBe(200);
  });
});
