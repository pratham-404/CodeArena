# CodeArena backend

The backend exposes the execution API and one WebSocket endpoint for language-server sessions. Its Docker image contains GCC/G++, Python, Java 21, clangd, Eclipse JDT LS, and Pyright; website users install none of them.

## Endpoints

- `GET /api/health`
- `POST /api/execute`
- `WS /lsp?language=c|cpp|java|python`

The browser uses a small JSON protocol over the WebSocket. The backend translates completion, hover, signature, document synchronization, and diagnostics to standard LSP messages over each language server's stdio stream.

## Development

The supported path is the repository-level Docker Compose stack. Running `npm start` directly is useful for API development but expects compiler and LSP commands on the backend machine.

```bash
npm install
npm test
npm start
```

With the Compose stack running, verify live completion from every packaged language server:

```bash
npm run test:live-lsp
```

Environment variables:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `PORT` | `8000` | HTTP/WebSocket port |
| `MAX_LSP_SESSIONS` | `20` | Concurrent language-server sessions |
| `LSP_IDLE_MS` | `300000` | Close idle language servers |
| `EXECUTION_TIMEOUT_MS` | `3000` | User program timeout |
| `COMPILATION_TIMEOUT_MS` | `10000` | Compiler timeout |
| `ALLOWED_ORIGINS` | same host | Additional WebSocket origins |

## Public-hosting boundary

The image removes host compiler setup, runs as a non-root user, limits request sizes, limits concurrency, and cleans temporary workspaces. Docker Compose also makes the filesystem read-only and constrains CPU, memory, and process counts.

Those controls do **not** make one persistent backend container a sufficient multi-tenant execution sandbox. Before accepting arbitrary public submissions, move `executeCode` behind a runner that creates a fresh gVisor container or microVM for every request, with no network, no secrets, no host mounts, and hard cgroup limits. Do not expose a Docker socket to this service.
