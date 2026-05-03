# Studio Backend

Express + Drizzle + Gemini agent orchestration API for **ClawStudio**.

This is the standalone backend service. The frontend lives at
[`sunpratik1772/Studio-frontend`](https://github.com/sunpratik1772/Studio-frontend).

---

## Architecture

```
src/
├── index.ts              # Bootstraps Express, starts pino, runs DB seed
├── app.ts                # Express app, CORS, pino-http, /api router mount
├── lib/
│   ├── logger.ts         # Singleton pino logger
│   └── db/               # Drizzle ORM client + Postgres schemas
│       ├── index.ts
│       └── schema/
│           ├── agentSessions.ts
│           ├── channelConfigs.ts
│           ├── memoryLogs.ts
│           └── skills.ts
├── schemas/              # Zod request/response schemas (orval-generated)
│   └── api.ts
├── routes/               # /api/* endpoints
│   ├── agents.ts         # CRUD agent sessions
│   ├── health.ts         # GET /api/healthz
│   ├── logs.ts           # Memory log + agent trace queries
│   ├── metrics.ts        # Token usage rollups
│   ├── runner.ts         # POST /api/agent/run-once  (Gemini one-shot)
│   ├── skills.ts         # Skills matrix CRUD
│   ├── tasks.ts          # POST /api/tasks/fan-out  (Promise.all parallel demo)
│   └── webhooks.ts       # POST /api/webhooks/:channel  (Slack/Teams/etc.)
└── services/
    ├── agentRunner.ts    # Gemini function-calling loop (real @google/genai)
    ├── seed.ts           # Idempotent demo data seed on first boot
    └── tools.ts          # 6 built-in tools (clock, math, lookup, notify, …)
```

### Request flow

```
client → CORS → pino-http → /api → router → service → Drizzle → Postgres
                                          ↳ @google/genai (Gemini)
```

### Tech

| Layer        | Choice                                                     |
| ------------ | ---------------------------------------------------------- |
| Runtime      | Node 22 (`type: module`, ESM)                              |
| HTTP         | Express 5                                                  |
| Validation   | Zod 3 (schemas auto-generated from OpenAPI in monorepo)    |
| ORM / DB     | Drizzle ORM + `pg` (`node-postgres`) on Postgres 14+       |
| Logging      | Pino + pino-http (JSON in prod, pretty in dev)             |
| LLM          | `@google/genai` (`gemini-2.5-flash` default)               |
| Bundler      | esbuild → single ESM file in `dist/index.mjs`              |

---

## Local development

### Prereqs

- Node 22+
- A Postgres database (local, Cloud SQL, Neon, Supabase — anything reachable)
- A `GOOGLE_API_KEY` from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### Run

```bash
cp .env.example .env
# Edit DATABASE_URL and GOOGLE_API_KEY

npm install
npm run db:push         # Pushes Drizzle schema to your DB (idempotent)
npm run dev             # tsx watch on src/index.ts → http://localhost:8080
```

Verify:

```bash
curl http://localhost:8080/api/healthz
# {"status":"ok"}

curl -X POST http://localhost:8080/api/agent/run-once \
  -H 'content-type: application/json' \
  -d '{"prompt":"What is 7 * 6?","model":"gemini-2.5-flash","maxSteps":4}'
```

### Build & run production bundle locally

```bash
npm run build           # esbuild → dist/index.mjs (single file, ~1MB)
npm start               # node dist/index.mjs
```

---

## Environment variables

| Variable         | Required | Default      | Notes                                          |
| ---------------- | :------: | ------------ | ---------------------------------------------- |
| `DATABASE_URL`   | ✅       | —            | Postgres connection string                     |
| `GOOGLE_API_KEY` | ✅       | —            | Gemini API key                                 |
| `PORT`           |          | `8080`       | Cloud Run injects this — do not hardcode       |
| `NODE_ENV`       |          | `production` | Pino switches to JSON output when `production` |
| `LOG_LEVEL`      |          | `info`       | `debug` / `info` / `warn` / `error`            |
| `CORS_ORIGIN`    |          | `*`          | Comma-separated origins, or `*` for any        |

---

## Docker

```bash
docker build -t studio-backend .
docker run --rm -p 8080:8080 \
  -e DATABASE_URL="$DATABASE_URL" \
  -e GOOGLE_API_KEY="$GOOGLE_API_KEY" \
  studio-backend
```

The image is multi-stage:

1. `node:22-alpine` — installs deps, runs `node build.mjs`, prunes dev deps.
2. `node:22-alpine` runtime — copies `dist/`, `node_modules/`, drops to non-root `node` user.

Final image is ~150 MB.

---

## Deploying to Google Cloud Run

```bash
# 1. Build and push to Artifact Registry
gcloud builds submit \
  --tag us-central1-docker.pkg.dev/$PROJECT_ID/studio/studio-backend:latest

# 2. Deploy
gcloud run deploy studio-backend \
  --image us-central1-docker.pkg.dev/$PROJECT_ID/studio/studio-backend:latest \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars NODE_ENV=production,LOG_LEVEL=info \
  --set-secrets DATABASE_URL=database-url:latest,GOOGLE_API_KEY=gemini-key:latest
```

Notes:

- Use **Cloud SQL Auth Proxy** or a serverless VPC connector for Cloud SQL Postgres.
- Use **Secret Manager** (`--set-secrets`) for `DATABASE_URL` and `GOOGLE_API_KEY` — never `--set-env-vars` for secrets.
- After the first deploy, capture the service URL; you'll set it as `VITE_API_BASE_URL` in the frontend build.
- For tighter security, drop `--allow-unauthenticated` and put both services behind a load balancer or an API gateway.

### Database migrations

Run from your laptop (not from the container):

```bash
DATABASE_URL="postgres://..." npm run db:push
```

`drizzle-kit push` is idempotent and detects schema drift. For production
schema versioning, switch to `drizzle-kit generate` + a migration runner.

---

## API surface

Everything lives under `/api`. Key endpoints:

| Method | Path                          | Purpose                                      |
| ------ | ----------------------------- | -------------------------------------------- |
| GET    | `/api/healthz`                | Liveness                                     |
| GET    | `/api/agents`                 | List agent sessions                          |
| POST   | `/api/agent/run-once`         | Run Gemini one-shot, return final + steps    |
| POST   | `/api/tasks/fan-out`          | Parallel `Promise.all` demo (proves N-ary)   |
| GET    | `/api/skills`                 | Skills matrix                                |
| GET    | `/api/logs`                   | Memory logs                                  |
| GET    | `/api/agents/:id/trace`       | Step-by-step trace for one session           |
| GET    | `/api/metrics/tokens`         | Token usage rollup                           |
| POST   | `/api/webhooks/:channel`      | Inbound channel webhook (slack/teams/…)      |

Schemas are validated with Zod on both ingress and egress. The OpenAPI spec
lives in the parent monorepo at `lib/api-spec/openapi.yaml`.

---

## License

MIT — internal demo project.
