===
# APIWatch — Lightweight API Health Monitor

APIWatch pings your endpoints on a configurable schedule, records response time and status history in PostgreSQL, exposes a REST API for queries, and renders a simple dashboard UI.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Docker Network                    │
│                                                     │
│  ┌──────────┐   poll    ┌───────────────────────┐   │
│  │ Scheduler │──────────▶│  Target Endpoints     │   │
│  │ (core)    │◀──────────│  (external APIs)      │   │
│  └─────┬─────┘  status   └───────────────────────┘   │
│        │                                             │
│        ▼ write                                       │
│  ┌──────────┐                                        │
│  │ PostgreSQL│                                       │
│  │   (db)    │                                       │
│  └─────┬─────┘                                       │
│        │ read                                         │
│  ┌─────▼──────────────────────┐                      │
│  │  API Server (Express)      │                      │
│  │  /api/status  /api/history │◀── HTTP clients      │
│  └─────┬──────────────────────┘                      │
│        │ serves                                      │
│  ┌─────▼──────┐                                      │
│  │ Dashboard  │                                      │
│  │  (static)  │                                      │
│  └────────────┘                                      │
└─────────────────────────────────────────────────────┘
```

**Components:**
- **Scheduler (core):** Runs on a timer, pings each endpoint, stores results in DB.
- **PostgreSQL:** Persists endpoint definitions, check results, and uptime history.
- **API Server:** Express REST API serving JSON (`/api/status`, `/api/history/:endpointId`, `/api/health`).
- **Dashboard:** Static HTML/JS served at `/`, displaying real-time status cards and sparkline charts.

## Quick Start

### Prerequisites
- Docker & Docker Compose v2+

### 1. Clone & Configure

```bash
git clone https://github.com/your-org/tpl-34cab2ff-apiwatch.git
cd tpl-34cab2ff-apiwatch
```

Create an `endpoints.json` in the project root:

```json
[
  {
    "id": "github-api",
    "name": "GitHub API",
    "url": "https://api.github.com/zen",
    "method": "GET",
    "expectedStatus": 200,
    "timeoutMs": 5000,
    "headers": {}
  },
  {
    "id": "example",
    "name": "Example.com",
    "url": "https://example.com",
    "method": "GET",
    "expectedStatus": 200,
    "timeoutMs": 5000,
    "headers": {}
  }
]
```

### 2. Set Environment (optional)

Copy `.env.example` to `.env` and customize:

```bash
DB_PASSWORD=changeme
PORT=3000
POLL_INTERVAL_MS=60000
```

### 3. Launch

```bash
docker compose -f deployment-documentation/docker-compose.yml up -d
```

Open **http://localhost:3000** to view the dashboard.

### 4. Query the API

```bash
# Overall status
curl http://localhost:3000/api/status

# History for a specific endpoint (last 100 checks)
curl http://localhost:3000/api/history/github-api?limit=100

# Service health
curl http://localhost:3000/api/health
```

## Configuration Reference

| Variable           | Default     | Description                              |
|--------------------|-------------|------------------------------------------|
| `DATABASE_URL`     | (required)  | PostgreSQL connection string             |
| `PORT`             | `3000`      | HTTP port for API + dashboard            |
| `POLL_INTERVAL_MS` | `60000`     | Milliseconds between endpoint checks     |
| `ENDPOINTS_CONFIG` | `endpoints.json` | Path to endpoint definitions file   |
| `NODE_ENV`         | `production`| Environment mode                        |

### Endpoint Definition Schema

| Field            | Type   | Required | Description                       |
|------------------|--------|----------|-----------------------------------|
| `id`             | string | yes      | Unique slug identifier            |
| `name`           | string | yes      | Human-readable label              |
| `url`            | string | yes      | Full URL to check                 |
| `method`         | string | no       | HTTP method (default `GET`)       |
| `expectedStatus` | number | no       | Expected status code (default 200)|
| `timeoutMs`      | number | no       | Request timeout (default 5000)    |
| `headers`        | object | no       | Custom request headers            |

## CI Pipeline

A GitHub Actions workflow runs on every push and PR:

1. **Lint** — ESLint across the codebase
2. **Test** — Jest unit + integration tests
3. **Build** — Docker image build (no push unless on main)

## Development

```bash
# Install dependencies
npm install

# Run in dev mode with hot reload
npm run dev

# Run tests
npm test

# Lint
npm run lint
```

## License

MIT