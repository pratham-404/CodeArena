# CodeArena

CodeArena is a browser-based C, C++, Java, and Python playground. Version 2 separates the Monaco frontend from the compiler and language-server backend.

```text
Browser: Monaco Editor
    ├── POST /api/execute ──> backend compiler/runtime
    └── WS /lsp ───────────> clangd | Eclipse JDT LS | Pyright
```

Website users need only a browser. The backend Docker image contains GCC/G++, Python, Java, clangd, JDT LS, and Pyright.

## Run the complete application

Install Docker with the Compose plugin, then run:

```bash
docker compose up --build
```

On Windows with Docker Desktop, run `npm start`. It starts Docker Desktop when needed, runs the stack, and after Ctrl+C removes the stack and closes Docker Desktop if it started it.

Open <http://localhost:8080>.

The first build downloads the pinned frontend packages, Ubuntu compiler packages, and the checksum-verified JDT LS archive. No host compiler or language-server installation is used.

## Repository layout

```text
frontend/            Monaco/Vite browser application
  README.md
backend/             HTTP execution API and WebSocket/LSP bridge
  README.md
docker-compose.yml   complete website stack
```

## Development checks

```bash
npm run install:all
npm test
npm run build
```

The compiler smoke checks are intended to run inside the backend image:

```bash
docker compose run --rm backend npm run test:toolchains
```

## Deployment

Deploy the frontend container publicly and keep the backend service private behind its nginx proxy. Set `PUBLIC_ORIGIN` to the browser-visible HTTPS origin:

```bash
PUBLIC_ORIGIN=https://code.example.com docker compose up -d --build
```

Terminate TLS at your load balancer or reverse proxy and preserve WebSocket upgrade headers for `/lsp`.

### Security boundary

The included stack is suitable for local development and a trusted/private deployment. It packages the toolchains and applies container-level limits, but user programs still share a persistent backend container with the API process.

Before accepting arbitrary public code, replace the local `executeCode` adapter with a per-request gVisor container or microVM runner. Give every run no network, no secrets, no host mounts, a read-only base image, an ephemeral workspace, and strict CPU/memory/PID/output/time limits. A normal Docker container is not the final multi-tenant sandbox.

Separate frontend and backend details are in [frontend/README.md](frontend/README.md) and [backend/README.md](backend/README.md).
