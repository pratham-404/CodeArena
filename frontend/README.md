# CodeArena frontend

The frontend is a Vite application using Monaco Editor. It keeps one in-browser model per language, persists drafts in `localStorage`, connects to the backend language servers over `/lsp`, and sends Run requests to `/api/execute`.

## Development

```bash
npm install
npm run dev
```

Vite proxies `/api` and `/lsp` to `http://127.0.0.1:8000`. Run the backend container from the repository root so no compiler or language server needs to be installed on the developer machine.

## Checks

```bash
npm test
npm run build
```

## Production

The frontend Docker image builds the static bundle and serves it through nginx. nginx proxies both HTTP execution requests and WebSocket language-server traffic to the private backend service.
