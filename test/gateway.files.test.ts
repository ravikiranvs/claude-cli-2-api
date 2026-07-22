import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { registerFilesRoutes } from "../src/gateway/files.js";
import type Database from "better-sqlite3";

function buildTestServer(uploadsDir: string): { server: FastifyInstance; db: Database.Database } {
  const db = openDatabase(":memory:");
  const server = Fastify();
  registerFilesRoutes(server, db, uploadsDir);
  return { server, db };
}

describe("File upload endpoints", () => {
  let dir: string;
  let uploadsDir: string;
  let server: FastifyInstance;
  let db: Database.Database;
  let baseUrl: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gateway-files-"));
    uploadsDir = join(dir, "uploads");
  });

  afterEach(async () => {
    await server.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a file upload and returns an OpenAI File-shaped response with a file id", async () => {
    ({ server, db } = buildTestServer(uploadsDir));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const form = new FormData();
    form.append("file", new Blob([Buffer.from("hello world")], { type: "text/plain" }), "notes.txt");

    const response = await fetch(`${baseUrl}/v1/files`, { method: "POST", body: form });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ object: "file", filename: "notes.txt", bytes: 11 });
    expect(body.id).toMatch(/^file-/);
    expect(body.created_at).toBeTypeOf("number");
  });

  it("writes the uploaded file's bytes to disk", async () => {
    ({ server, db } = buildTestServer(uploadsDir));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const form = new FormData();
    form.append("file", new Blob([Buffer.from("hello world")], { type: "text/plain" }), "notes.txt");

    const response = await fetch(`${baseUrl}/v1/files`, { method: "POST", body: form });
    const body = (await response.json()) as Record<string, any>;

    const row = db.prepare("SELECT storage_path FROM uploaded_files WHERE id = ?").get(body.id) as {
      storage_path: string;
    };
    expect(existsSync(row.storage_path)).toBe(true);
    expect((await readFile(row.storage_path)).toString()).toBe("hello world");
  });

  it("rejects a request with no file field with 400", async () => {
    ({ server, db } = buildTestServer(uploadsDir));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const form = new FormData();
    form.append("purpose", "assistants");

    const response = await fetch(`${baseUrl}/v1/files`, { method: "POST", body: form });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(400);
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("lists previously uploaded files, newest first", async () => {
    ({ server, db } = buildTestServer(uploadsDir));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    for (const name of ["first.txt", "second.txt"]) {
      const form = new FormData();
      form.append("file", new Blob([Buffer.from("x")], { type: "text/plain" }), name);
      await fetch(`${baseUrl}/v1/files`, { method: "POST", body: form });
    }

    const response = await fetch(`${baseUrl}/v1/files`);
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body.object).toBe("list");
    expect(body.data.map((file: any) => file.filename)).toEqual(["second.txt", "first.txt"]);
  });

  it("deletes an uploaded file, removing it from both the list and disk", async () => {
    ({ server, db } = buildTestServer(uploadsDir));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const form = new FormData();
    form.append("file", new Blob([Buffer.from("hello world")], { type: "text/plain" }), "notes.txt");
    const uploadResponse = await fetch(`${baseUrl}/v1/files`, { method: "POST", body: form });
    const uploaded = (await uploadResponse.json()) as Record<string, any>;

    const row = db.prepare("SELECT storage_path FROM uploaded_files WHERE id = ?").get(uploaded.id) as {
      storage_path: string;
    };

    const deleteResponse = await fetch(`${baseUrl}/v1/files/${uploaded.id}`, { method: "DELETE" });
    const deleteBody = (await deleteResponse.json()) as Record<string, any>;

    expect(deleteResponse.status).toBe(200);
    expect(deleteBody).toEqual({ id: uploaded.id, object: "file", deleted: true });
    expect(existsSync(row.storage_path)).toBe(false);

    const listResponse = await fetch(`${baseUrl}/v1/files`);
    const listBody = (await listResponse.json()) as Record<string, any>;
    expect(listBody.data).toHaveLength(0);
  });

  it("returns 404 when deleting a file id that doesn't exist", async () => {
    ({ server, db } = buildTestServer(uploadsDir));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`${baseUrl}/v1/files/file-does-not-exist`, { method: "DELETE" });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(404);
    expect(body.error.type).toBe("invalid_request_error");
  });

  it("writes a Trace row for an upload, a list, and a delete", async () => {
    ({ server, db } = buildTestServer(uploadsDir));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const form = new FormData();
    form.append("file", new Blob([Buffer.from("hello world")], { type: "text/plain" }), "notes.txt");
    const uploadResponse = await fetch(`${baseUrl}/v1/files`, { method: "POST", body: form });
    const uploaded = (await uploadResponse.json()) as Record<string, any>;

    await fetch(`${baseUrl}/v1/files`);
    await fetch(`${baseUrl}/v1/files/${uploaded.id}`, { method: "DELETE" });

    const rows = db.prepare("SELECT endpoint, http_status FROM traces ORDER BY id").all() as Array<{
      endpoint: string;
      http_status: number;
    }>;

    expect(rows).toEqual([
      { endpoint: "/v1/files", http_status: 200 },
      { endpoint: "/v1/files", http_status: 200 },
      { endpoint: "/v1/files/:id", http_status: 200 },
    ]);
  });

  it("writes a Trace row for a rejected upload", async () => {
    ({ server, db } = buildTestServer(uploadsDir));
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });

    const form = new FormData();
    form.append("purpose", "assistants");
    await fetch(`${baseUrl}/v1/files`, { method: "POST", body: form });

    const row = db.prepare("SELECT endpoint, http_status FROM traces").get() as {
      endpoint: string;
      http_status: number;
    };
    expect(row).toEqual({ endpoint: "/v1/files", http_status: 400 });
  });
});
