import { spawn } from "node:child_process";
import type { ClaudeSubprocess, ClaudeSubprocessResult } from "./types.js";

export class RealClaudeSubprocess implements ClaudeSubprocess {
  send(prompt: string): Promise<ClaudeSubprocessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn("claude", ["-p", prompt, "--output-format", "stream-json"]);

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`claude subprocess exited with code ${code}: ${stderr}`));
          return;
        }
        resolve({ raw: stdout });
      });
    });
  }
}
