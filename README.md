# Claude Code Gateway

An OpenAI-compatible API server backed by the [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI. Point any OpenAI SDK or tool at this gateway instead of `api.openai.com`, and your requests run through Claude Code — with its full agentic tool use — instead of a plain chat API.

It ships as a Docker container with two things running inside:

- **Gateway API** (port `3000`) — the OpenAI-compatible endpoints your apps call.
- **Admin Console** (port `3001`) — a web UI for creating API keys and inspecting request traces.

## Quick start (Docker)

```
docker build -t claude-gateway .
docker volume create claude-auth
docker run -d --name claude-gateway \
  -p 3000:3000 -p 3001:3001 \
  -v claude-auth:/home/node/.claude \
  -v gateway-data:/app/data \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=change-me \
  claude-gateway
```

Then log Claude Code in, once, inside the running container:

```
docker exec -it claude-gateway claude login
```

The container serves traffic right away, but any request that needs to run Claude will return `502` until this login step is done. The `claude-auth` volume keeps you logged in across restarts.

Open `http://localhost:3001/login` and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD` to create your first Gateway API Key.

## Configuration

Set these as environment variables (e.g. `-e NAME=value` on `docker run`):

| Variable | Default | Description |
|---|---|---|
| `GATEWAY_PORT` | `3000` | Port for the client-facing API |
| `ADMIN_PORT` | `3001` | Port for the Admin Console |
| `HOST` | `0.0.0.0` | Network interface to bind to |
| `ADMIN_USERNAME` | `admin` | Admin Console login username |
| `ADMIN_PASSWORD` | `change-me` | Admin Console login password — change this |
| `ADMIN_SECRET` | *(falls back to `ADMIN_PASSWORD`)* | Signs Admin Console session cookies |

If you change `GATEWAY_PORT` or `ADMIN_PORT`, update the `-p` mappings on `docker run` to match.

## Using the API

1. Sign in to the Admin Console at `http://localhost:3001`.
2. Go to **Keys** and create a Gateway API Key. The key is shown once — copy it now.
3. Call the gateway like you would call OpenAI's API, using that key as your bearer token:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer gwk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

This also works as a drop-in base URL with the official OpenAI SDKs — just set `baseURL` to `http://localhost:3000/v1` and `apiKey` to your `gwk_...` key.

### Supported endpoints

- `POST /v1/chat/completions` — chat completions, with streaming (`"stream": true`) support. Message content can include text, images (`image_url`), and uploaded files.
- `POST /v1/completions` — legacy text completion.
- `POST /v1/files` — upload a file to reference in later chat messages.
- `GET /v1/files` / `DELETE /v1/files/:id` — list or remove uploaded files.
- `GET /health` — unauthenticated health check.

Each API key has its own rate limit (tokens/minute), set when you create the key in the Admin Console.

### Data retention

Uploaded files and request traces are automatically deleted after 7 days.

## Admin Console

- **Keys** — create and revoke Gateway API Keys.
- **Traces** — browse recent requests and responses per key, useful for debugging what a client sent and what Claude returned.

## Running locally without Docker

Requires Node.js >= 20 and the `claude` CLI installed and logged in (`claude login`) on your machine.

```
npm install
npm run dev
```

This starts both servers directly from source (no build step). Copy `.env.example` to `.env` first if you want to customize ports or credentials.
