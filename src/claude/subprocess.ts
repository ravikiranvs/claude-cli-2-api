import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { ClaudeSubprocess, ClaudeSubprocessResult } from "./types.js";

export class RealClaudeSubprocess implements ClaudeSubprocess {
  async send(prompt: string): Promise<ClaudeSubprocessResult> {
    const lines: string[] = [];
    for await (const line of this.stream(prompt)) {
      lines.push(line);
    }
    return { raw: lines.join("\n") };
  }

  async *stream(prompt: string): AsyncIterable<string> {
    const child = spawn("claude", ["-p", prompt, "--output-format", "stream-json"]);

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const closed = new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => resolve(code));
    });
    closed.catch(() => {});

    const rl = createInterface({ input: child.stdout });
    try {
      for await (const line of rl) {
        yield line;
      }
    } finally {
      rl.close();
    }

    const code = await closed;
    if (code !== 0) {
      throw new Error(`claude subprocess exited with code ${code}: ${stderr}`);
    }
  }
}
