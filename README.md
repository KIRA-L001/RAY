# RAY
AI-powered commerce platform that makes any merchant website discoverable and transactable by AI. It connects a merchant’s website, catalog, customer activity, AI agents, and Razorpay payments into one system—helping merchants turn AI conversations into real sales and identify opportunities to grow revenue.

## Local development

Prerequisites: Node 22+ (`.node-version`), pnpm 9, Docker Desktop.

```bash
pnpm install          # workspace deps
pnpm bootstrap        # start postgres+redis, apply migrations, seed demo data
pnpm dev              # run all apps + worker
```

| Service | URL |
|---|---|
| API (NestJS/Fastify) | http://localhost:4000 |
| Admin app | http://localhost:3000 |
| AI Buyer app | http://localhost:3001 |
| Merchant desktop (Vite) | http://localhost:5173 (`tauri dev` in `apps/desktop/src-tauri` for the window) |
| Worker process | logs to console (no port) |

Seeded admin login: `admin@ray.local` / `admin123`.

Useful scripts: `pnpm db:migrate` (create/apply migrations), `pnpm db:studio`, `docker compose down` (keeps data volumes).
