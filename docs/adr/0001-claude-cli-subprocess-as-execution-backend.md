# Claude Code CLI subprocess as execution backend

Rather than calling the Anthropic API directly, the Gateway shells out to `claude -p` per request using `--output-format stream-json`. This preserves the full Claude Code agentic surface (tool use, file access, multi-step reasoning) without duplicating it via the raw API. The trade-off is subprocess overhead and tighter coupling to the CLI's interface and versioning — a future switch to direct API calls would require reimplementing that surface.

## Considered options

- **Direct Anthropic API** — simpler HTTP calls, full control over the request lifecycle, but loses Claude Code's agentic capabilities and requires Claude Code to only be an auth mechanism rather than the execution engine.
- **Claude Code CLI subprocess** — chosen. Execution is delegated entirely to the CLI; the Gateway is a thin dispatcher.
