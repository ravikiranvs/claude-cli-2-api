# Claude Code Gateway

A containerized service that exposes an OpenAI-compatible API backed by the Claude Code CLI, with an integrated web admin console for key management and request inspection.

## Language

### Gateway

**Gateway**:
The HTTP server that exposes the OpenAI-compatible API on a dedicated port. It authenticates incoming requests via Gateway API Keys, enforces rate limits, and dispatches each request to a Claude Subprocess.
_Avoid_: API server, proxy, backend

**Gateway API Key**:
A credential generated in the Admin Console that a client presents per-request to authenticate to the Gateway. Each key has its own Rate Limit.
_Avoid_: API key (ambiguous with the Anthropic/Claude API key), token

**Rate Limit**:
A per-Gateway-API-Key cap expressed in tokens per minute. Enforced using approximate token counting.

**Concurrency Pool**:
A semaphore that caps simultaneous Claude Subprocess invocations at 3, preventing resource exhaustion under concurrent load.

### Execution

**Claude Subprocess**:
A `claude -p` process spawned per Gateway request. Receives the client-supplied messages array as input and streams its output back via `--output-format stream-json`. Image inputs are written to a temporary file and passed as a file-path reference in the prompt.
_Avoid_: Backend, LLM, model

### Observability

**Trace**:
A verbatim record of a single API request and its response body, stored in SQLite. Hard-deleted after 7 days.
_Avoid_: Log, audit log (a Trace stores full message content, not just metadata)

### Administration

**Admin Console**:
The web UI served on a second port. Authenticated by a single admin account configured via `ADMIN_USERNAME` and `ADMIN_PASSWORD` environment variables. Provides Gateway API Key management and Trace browsing.
_Avoid_: Dashboard, admin panel
