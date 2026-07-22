# Claude Code Gateway

## Running with Docker

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

- `GATEWAY_PORT` / `ADMIN_PORT` (default `3000` / `3001`) and `HOST` (default `0.0.0.0`) are configurable via environment variables; adjust the `-p` mappings to match if you change the ports.
- The `claude-auth` volume persists the `claude login` OAuth credentials (`~/.claude` inside the container) across restarts — see `docs/adr/0003-claude-auth-via-docker-volume.md`.
- The container starts and serves traffic even before authentication is set up; requests that need the Claude Subprocess will return a `502` until you log in.

One-time setup after the container is running:

```
docker exec -it claude-gateway claude login
```

## Following skills have been installed

```
npx skills add https://github.com/mattpocock/skills `
  --skill setup-matt-pocock-skills `
  --skill ask-matt `
  --skill grill-with-docs `
  --skill triage `
  --skill improve-codebase-architecture `
  --skill to-spec `
  --skill to-tickets `
  --skill implement `
  --skill wayfinder `
  --skill prototype `
  --skill diagnosing-bugs `
  --skill research `
  --skill tdd `
  --skill domain-modeling `
  --skill codebase-design `
  --skill code-review `
  --skill resolving-merge-conflicts `
  --agent claude-code `
  --yes
```