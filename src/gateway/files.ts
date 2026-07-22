import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import multipart from "@fastify/multipart";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { insertTrace } from "../db/traces.js";
import { createUploadedFile, deleteUploadedFile, getUploadedFile, listUploadedFiles } from "../db/uploadedFiles.js";
import type { UploadedFile } from "../db/uploadedFiles.js";
import { gatewayErrorBody } from "./errorBody.js";
import { sendErrorAndTrace } from "./routeErrors.js";

export const FILES_PATH = "/v1/files";

function toFileObject(file: UploadedFile): Record<string, unknown> {
  return {
    id: file.id,
    object: "file",
    bytes: file.byteSize,
    created_at: Math.floor(new Date(file.createdAt).getTime() / 1000),
    filename: file.filename,
    purpose: "assistants",
  };
}

export function registerFilesRoutes(server: FastifyInstance, db: Database.Database, uploadsDir: string): void {
  server.register(multipart);
  // Eager, matching openDatabase's precedent for databasePath: fail at setup, not on first request.
  mkdirSync(uploadsDir, { recursive: true });

  const recordTrace = (
    endpoint: string,
    gatewayApiKeyId: number | null,
    requestBodyJson: string,
    httpStatus: number,
    responseBody: unknown,
  ): void => {
    insertTrace(db, {
      gatewayApiKeyId,
      endpoint,
      httpStatus,
      requestBody: requestBodyJson,
      responseBody: JSON.stringify(responseBody),
      tokenCount: null,
    });
  };

  server.post(FILES_PATH, async (request, reply) => {
    const gatewayApiKeyId = request.gatewayApiKeyId ?? null;

    let uploaded;
    try {
      uploaded = await request.file();
    } catch {
      uploaded = undefined;
    }
    if (!uploaded) {
      sendErrorAndTrace(
        reply,
        db,
        FILES_PATH,
        gatewayApiKeyId,
        JSON.stringify({}),
        400,
        "A multipart `file` field is required",
        "invalid_request_error",
      );
      return;
    }

    const buffer = await uploaded.toBuffer();
    const requestBodyJson = JSON.stringify({ filename: uploaded.filename, contentType: uploaded.mimetype ?? null });
    const id = `file-${randomUUID()}`;
    const storagePath = join(uploadsDir, id);
    await writeFile(storagePath, buffer);

    let created: UploadedFile;
    try {
      created = createUploadedFile(db, {
        id,
        filename: uploaded.filename,
        contentType: uploaded.mimetype || null,
        byteSize: buffer.length,
        storagePath,
      });
    } catch (err) {
      // The row was never created, so the file we just wrote would otherwise be orphaned.
      await rm(storagePath, { force: true });
      sendErrorAndTrace(
        reply,
        db,
        FILES_PATH,
        gatewayApiKeyId,
        requestBodyJson,
        502,
        `Failed to record uploaded file: ${err instanceof Error ? err.message : String(err)}`,
        "api_error",
      );
      return;
    }

    const responseBody = toFileObject(created);
    recordTrace(FILES_PATH, gatewayApiKeyId, requestBodyJson, 200, responseBody);
    reply.status(200).send(responseBody);
  });

  server.get(FILES_PATH, async (request, reply) => {
    const gatewayApiKeyId = request.gatewayApiKeyId ?? null;
    const files = listUploadedFiles(db);
    const responseBody = { object: "list", data: files.map(toFileObject) };
    recordTrace(FILES_PATH, gatewayApiKeyId, JSON.stringify({}), 200, responseBody);
    reply.status(200).send(responseBody);
  });

  server.delete<{ Params: { id: string } }>(`${FILES_PATH}/:id`, async (request, reply) => {
    const gatewayApiKeyId = request.gatewayApiKeyId ?? null;
    const { id } = request.params;
    const requestBodyJson = JSON.stringify({ id });

    const file = getUploadedFile(db, id);
    if (!file) {
      sendErrorAndTrace(
        reply,
        db,
        `${FILES_PATH}/:id`,
        gatewayApiKeyId,
        requestBodyJson,
        404,
        `No such file: ${id}`,
        "invalid_request_error",
      );
      return;
    }

    try {
      await rm(file.storagePath, { force: true });
    } catch (err) {
      // Disk delete failed for a reason other than "already gone" (force swallows ENOENT) —
      // leave the DB row in place so the file stays discoverable/retryable rather than orphaning
      // the on-disk bytes with no tracking.
      sendErrorAndTrace(
        reply,
        db,
        `${FILES_PATH}/:id`,
        gatewayApiKeyId,
        requestBodyJson,
        502,
        `Failed to delete file from disk: ${err instanceof Error ? err.message : String(err)}`,
        "api_error",
      );
      return;
    }
    deleteUploadedFile(db, id);

    const responseBody = { id, object: "file", deleted: true };
    recordTrace(`${FILES_PATH}/:id`, gatewayApiKeyId, requestBodyJson, 200, responseBody);
    reply.status(200).send(responseBody);
  });
}
