import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  isValidContent,
  MAX_IMAGES_PER_REQUEST,
  MAX_IMAGE_BYTES,
  validateImageContent,
} from "../src/gateway/chatImages.js";

const TINY_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const TINY_PNG_DATA_URI = `data:image/png;base64,${TINY_PNG_BASE64}`;

function oversizedDataUri(mimeType: string, bytes: number): string {
  return `data:${mimeType};base64,${Buffer.alloc(bytes, 1).toString("base64")}`;
}

describe("isValidContent", () => {
  it("accepts a plain string", () => {
    expect(isValidContent("hello")).toBe(true);
  });

  it("accepts a valid array of text and image_url parts", () => {
    expect(
      isValidContent([
        { type: "text", text: "hi" },
        { type: "image_url", image_url: { url: TINY_PNG_DATA_URI } },
      ]),
    ).toBe(true);
  });

  it("rejects an empty array", () => {
    expect(isValidContent([])).toBe(false);
  });

  it("rejects a part with an unrecognized type", () => {
    expect(isValidContent([{ type: "audio", audio: "..." }])).toBe(false);
  });

  it("rejects an image_url part missing the nested url", () => {
    expect(isValidContent([{ type: "image_url", image_url: {} }])).toBe(false);
  });

  it("accepts a valid file part", () => {
    expect(isValidContent([{ type: "file", file_id: "file-abc123" }])).toBe(true);
  });

  it("rejects a file part missing file_id", () => {
    expect(isValidContent([{ type: "file" }])).toBe(false);
  });

  it("rejects a non-string, non-array content value", () => {
    expect(isValidContent(42)).toBe(false);
  });
});

describe("validateImageContent", () => {
  it("returns null when there are no image content blocks", () => {
    expect(validateImageContent([{ role: "user", content: "hi" }])).toBeNull();
  });

  it("returns null for a valid image within format and size limits", () => {
    const error = validateImageContent([
      { role: "user", content: [{ type: "image_url", image_url: { url: TINY_PNG_DATA_URI } }] },
    ]);
    expect(error).toBeNull();
  });

  it("matches supported MIME types case-insensitively", () => {
    const error = validateImageContent([
      { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/PNG;base64,${TINY_PNG_BASE64}` } }] },
    ]);
    expect(error).toBeNull();
  });

  it("rejects an unsupported image format with a clear error", () => {
    const error = validateImageContent([
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" } }],
      },
    ]);
    expect(error).toContain("Unsupported image format");
    expect(error).toContain("image/svg+xml");
  });

  it("rejects an image over the 5MB size limit with a clear error", () => {
    const error = validateImageContent([
      { role: "user", content: [{ type: "image_url", image_url: { url: oversizedDataUri("image/png", MAX_IMAGE_BYTES + 1) } }] },
    ]);
    expect(error).toContain("5MB");
  });

  it("accepts an image right at the 5MB size limit", () => {
    const error = validateImageContent([
      { role: "user", content: [{ type: "image_url", image_url: { url: oversizedDataUri("image/png", MAX_IMAGE_BYTES) } }] },
    ]);
    expect(error).toBeNull();
  });

  it("rejects an image_url that isn't a base64 data URI", () => {
    const error = validateImageContent([
      { role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/cat.png" } }] },
    ]);
    expect(error).toContain("data URI");
  });

  it("rejects a request with more than the maximum number of images, counted across all messages", () => {
    const imagePart = { type: "image_url" as const, image_url: { url: TINY_PNG_DATA_URI } };
    const messages = [
      { role: "user", content: Array(MAX_IMAGES_PER_REQUEST).fill(imagePart) },
      { role: "user", content: [imagePart] },
    ];
    const error = validateImageContent(messages);
    expect(error).toContain(`${MAX_IMAGES_PER_REQUEST}`);
  });

  it("accepts exactly the maximum number of images", () => {
    const imagePart = { type: "image_url" as const, image_url: { url: TINY_PNG_DATA_URI } };
    const error = validateImageContent([{ role: "user", content: Array(MAX_IMAGES_PER_REQUEST).fill(imagePart) }]);
    expect(error).toBeNull();
  });
});

describe("buildPrompt", () => {
  it("builds the same prompt as before for text-only messages", async () => {
    const { prompt, cleanup } = await buildPrompt([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
    await cleanup();

    expect(prompt).toBe("user: hi\n\nassistant: hello");
  });

  it("writes image bytes to a temp file and injects the path into the prompt", async () => {
    const { prompt, cleanup } = await buildPrompt([
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image_url", image_url: { url: TINY_PNG_DATA_URI } },
        ],
      },
    ]);

    const pathMatch = /\[image attached: (.+?)\]/.exec(prompt);
    expect(pathMatch).not.toBeNull();
    const path = pathMatch![1];

    expect(existsSync(path)).toBe(true);
    const written = await readFile(path);
    expect(written.equals(Buffer.from(TINY_PNG_BASE64, "base64"))).toBe(true);
    expect(prompt).toContain("what is this?");

    await cleanup();
    expect(existsSync(path)).toBe(false);
  });

  it("cleanup removes every temp file written across multiple images", async () => {
    const { prompt, cleanup } = await buildPrompt([
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: TINY_PNG_DATA_URI } },
          { type: "image_url", image_url: { url: TINY_PNG_DATA_URI } },
        ],
      },
    ]);

    const paths = [...prompt.matchAll(/\[image attached: (.+?)\]/g)].map((match) => match[1]);
    expect(paths).toHaveLength(2);
    for (const path of paths) expect(existsSync(path)).toBe(true);

    await cleanup();
    for (const path of paths) expect(existsSync(path)).toBe(false);
  });

  it("resolves a `file` content part via resolveFile and injects its stored path, without writing a temp file", async () => {
    const { prompt, cleanup } = await buildPrompt(
      [
        {
          role: "user",
          content: [
            { type: "text", text: "summarize this" },
            { type: "file", file_id: "file-abc123" },
          ],
        },
      ],
      { resolveFile: (fileId) => (fileId === "file-abc123" ? { storagePath: "/data/uploads/file-abc123" } : undefined) },
    );
    await cleanup();

    expect(prompt).toContain("summarize this");
    expect(prompt).toContain("[file attached: /data/uploads/file-abc123]");
  });

  it("silently skips a `file` content part that resolveFile can't resolve", async () => {
    const { prompt, cleanup } = await buildPrompt(
      [{ role: "user", content: [{ type: "file", file_id: "file-missing" }] }],
      { resolveFile: () => undefined },
    );
    await cleanup();

    expect(prompt).not.toContain("[file attached:");
  });
});
