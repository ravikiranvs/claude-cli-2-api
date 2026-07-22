import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_REQUEST = 100;

/**
 * Fastify's JSON body parser must accept a request carrying MAX_IMAGES_PER_REQUEST images at
 * MAX_IMAGE_BYTES each, base64-encoded (~4/3 inflation), plus headroom for JSON structure —
 * otherwise a request within our own limits would be rejected at the transport layer before
 * ever reaching that validation.
 */
export const MAX_REQUEST_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES * (4 / 3) * MAX_IMAGES_PER_REQUEST * 1.05);
export const SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

const DATA_URI_PATTERN = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+=*)$/;

interface ParsedDataUri {
  mimeType: string;
  base64: string;
}

/** Parses a `data:<mime-type>;base64,<data>` URI. MIME types are matched case-insensitively per RFC 2045. */
function parseDataUri(url: string): ParsedDataUri | null {
  const match = DATA_URI_PATTERN.exec(url);
  if (!match) return null;
  const [, mimeType, base64] = match;
  return { mimeType: mimeType.toLowerCase(), base64 };
}

export interface TextContentPart {
  type: "text";
  text: string;
}

export interface ImageContentPart {
  type: "image_url";
  image_url: { url: string };
}

/** References a file previously uploaded via POST /v1/files, made available to the Claude Subprocess as context. */
export interface FileContentPart {
  type: "file";
  file_id: string;
}

export type ContentPart = TextContentPart | ImageContentPart | FileContentPart;

export interface ChatMessageInput {
  role: string;
  content: string | ContentPart[];
}

function isContentPart(value: unknown): value is ContentPart {
  if (typeof value !== "object" || value === null) return false;
  const part = value as Record<string, unknown>;

  if (part.type === "text") {
    return typeof part.text === "string";
  }
  if (part.type === "image_url") {
    return (
      typeof part.image_url === "object" &&
      part.image_url !== null &&
      typeof (part.image_url as Record<string, unknown>).url === "string"
    );
  }
  if (part.type === "file") {
    return typeof part.file_id === "string";
  }
  return false;
}

/** True for a valid OpenAI chat message `content` value: a string, or a non-empty array of text/image_url/file parts. */
export function isValidContent(content: unknown): content is string | ContentPart[] {
  if (typeof content === "string") return true;
  return Array.isArray(content) && content.length > 0 && content.every(isContentPart);
}

function isImagePart(part: ContentPart): part is ImageContentPart {
  return part.type === "image_url";
}

function imagePartsOf(messages: ChatMessageInput[]): ImageContentPart[] {
  return messages.flatMap((message) => (Array.isArray(message.content) ? message.content.filter(isImagePart) : []));
}

function estimateBase64ByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Validates every image content block across all messages: a supported format, ≤5MB, and
 * ≤100 images total per request. Returns a clear error message, or null if every image is
 * valid. Cheap on purpose — sizes are estimated from the base64 string length, so an
 * oversized image is rejected without decoding it.
 */
export function validateImageContent(messages: ChatMessageInput[]): string | null {
  const imageParts = imagePartsOf(messages);

  if (imageParts.length > MAX_IMAGES_PER_REQUEST) {
    return `A request may include at most ${MAX_IMAGES_PER_REQUEST} images (received ${imageParts.length})`;
  }

  for (const part of imageParts) {
    const parsed = parseDataUri(part.image_url.url);
    if (!parsed) {
      return "Image content blocks must be a base64 data URI (data:<mime-type>;base64,<data>)";
    }

    if (!SUPPORTED_IMAGE_MIME_TYPES.has(parsed.mimeType)) {
      return `Unsupported image format: ${parsed.mimeType} (supported: ${[...SUPPORTED_IMAGE_MIME_TYPES].join(", ")})`;
    }
    if (estimateBase64ByteLength(parsed.base64) > MAX_IMAGE_BYTES) {
      return `Image exceeds the ${MAX_IMAGE_BYTES / (1024 * 1024)}MB size limit`;
    }
  }

  return null;
}

export interface BuiltPrompt {
  prompt: string;
  /** Deletes every temp file written for this prompt. Call once the Claude Subprocess has exited, on both success and failure. */
  cleanup: () => Promise<void>;
}

export interface BuildPromptOptions {
  /** Looks up an uploaded file's on-disk path by id, for `file` content parts. Undefined/no match is skipped silently — file references are validated (existence-checked) upstream by `validateFileReferences`. */
  resolveFile?: (fileId: string) => { storagePath: string } | undefined;
}

/**
 * Builds the reconstructed prompt from a chat messages array — the single string channel the
 * Claude Subprocess accepts. Image content blocks are written to temp files (deleted by the
 * returned `cleanup`) and referenced by path; `file` content parts referencing a previously
 * uploaded file are resolved via `options.resolveFile` and referenced by their existing,
 * persistent on-disk path (no temp file, no cleanup needed for those). Messages are validated
 * by `validateImageContent`/`validateFileReferences` first, so this assumes every image_url is
 * a well-formed, supported, in-limit data URI and every file_id resolves.
 */
export async function buildPrompt(messages: ChatMessageInput[], options: BuildPromptOptions = {}): Promise<BuiltPrompt> {
  const tempFilePaths: string[] = [];

  const cleanup = async (): Promise<void> => {
    await Promise.all(tempFilePaths.map((path) => rm(path, { force: true })));
  };

  try {
    const lines: string[] = [];

    for (const message of messages) {
      if (typeof message.content === "string") {
        lines.push(`${message.role}: ${message.content}`);
        continue;
      }

      const parts: string[] = [];
      for (const part of message.content) {
        if (part.type === "text") {
          parts.push(part.text);
          continue;
        }

        if (part.type === "file") {
          // Referenced by path, not inlined — ADR-0001 chose the Claude Subprocess specifically
          // to preserve Claude Code's own agentic file access, so the CLI reads the file itself.
          const resolved = options.resolveFile?.(part.file_id);
          if (resolved) {
            parts.push(`[file attached: ${resolved.storagePath}]`);
          } // else: unresolved reference; validated upstream by validateFileReferences, unreachable in practice
          continue;
        }

        const parsed = parseDataUri(part.image_url.url);
        if (!parsed) continue; // validated upstream; unreachable in practice

        const extension = MIME_EXTENSIONS[parsed.mimeType] ?? "bin";
        const path = join(tmpdir(), `gateway-image-${randomUUID()}.${extension}`);
        await writeFile(path, Buffer.from(parsed.base64, "base64"));
        tempFilePaths.push(path);
        parts.push(`[image attached: ${path}]`);
      }
      lines.push(`${message.role}: ${parts.join(" ")}`);
    }

    return { prompt: lines.join("\n\n"), cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
