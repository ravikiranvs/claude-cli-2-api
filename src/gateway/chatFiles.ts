import type Database from "better-sqlite3";
import { getUploadedFile } from "../db/uploadedFiles.js";
import type { ChatMessageInput, ContentPart, FileContentPart } from "./chatImages.js";

function isFilePart(part: ContentPart): part is FileContentPart {
  return part.type === "file";
}

function fileReferencesOf(messages: ChatMessageInput[]): FileContentPart[] {
  return messages.flatMap((message) => (Array.isArray(message.content) ? message.content.filter(isFilePart) : []));
}

/**
 * Validates that every `file` content block across all messages references a file that was
 * actually uploaded via POST /v1/files. Returns a clear error message, or null if every
 * reference resolves.
 */
export function validateFileReferences(messages: ChatMessageInput[], db: Database.Database): string | null {
  for (const part of fileReferencesOf(messages)) {
    if (!getUploadedFile(db, part.file_id)) {
      return `Unknown file id: ${part.file_id}`;
    }
  }
  return null;
}

/** Builds a resolver for buildPrompt() that looks up an uploaded file's on-disk path by id. */
export function createFileResolver(db: Database.Database): (fileId: string) => { storagePath: string } | undefined {
  return (fileId) => {
    const file = getUploadedFile(db, fileId);
    return file ? { storagePath: file.storagePath } : undefined;
  };
}
