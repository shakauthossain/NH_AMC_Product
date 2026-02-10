# Developer Guide — NH AMC Product

This guide walks you through setting up the development environment, running all services locally, and working with the codebase day-to-day.

---

## Prerequisites

Before you begin, make sure you have the following installed:

| Tool               | Version | Purpose                         |
| ------------------ | ------- | ------------------------------- |
| **Python**         | 3.10+   | Backend API & Celery workers    |
| **Node.js**        | 22+     | Frontend build & dev server     |
| **npm**            | 10+     | Frontend dependency management  |
| **Redis**          | 7+      | Celery message broker & backend |
| **Docker**         | 24+     | Containerized deployment        |
| **Docker Compose** | 2.x     | Multi-container orchestration   |
| **Git**            | 2.x     | Version control                 |
| **curl** / **jq**  | —       | API testing (optional)          |

---

## Project Layout

The project is a **multi-service** application. Here's what each directory is for:

```
NH AMC Product/
├── Dev_Fabric/     ← 🔧 Primary backend (FastAPI + Celery + Fabric)  ← START HERE
├── Frontend/       ← 🖥️  Dashboard UI (React + Vite + TypeScript)
├── Dev_API/        ← 🧪 Secondary backend prototype (not active)
├── Dev/            ← 📜 Standalone Python utility scripts
├── Backend/        ← 📦 Scaffolded backend (empty, unused)
└── Revamp/         ← 🚧 Reserved for future refactoring
```

> **Active services:** Only `Dev_Fabric` (backend) and `Frontend` are needed for development.

---

## Quick Start

### 1. Clone the Repository

```bash
git clone <repo-url>
cd "NH AMC Product"
```

### 2. Start the Backend (Dev_Fabric)

```bash
cd Dev_Fabric

# Create virtual environment
python -m venv venv
source venv/bin/activate    # Linux/macOS
# venv\Scripts\activate     # Windows

# Install dependencies
pip install -r requirements.txt

# Make sure Redis is running
redis-server &              # or use Docker: docker run -d -p 6379:6379 redis:7-alpine

# Start FastAPI server (terminal 1)
uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# Start Celery worker (terminal 2)
celery -A celery_app worker --loglevel=info --pool=solo
```

The API will be available at **http://localhost:8001**. Visit http://localhost:8001/docs for the interactive Swagger UI.

### 3. Start the Frontend

```bash
cd Frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

The dashboard will be available at **http://localhost:8080**.

> The dev server is pre-configured to point to `http://localhost:8001` via `.env.development`.

### 4. Verify Everything Works

```bash
# Health check
curl http://localhost:8001/
# Expected: {"ok": true, "service": "NH AMC Fabric MVP"}

# Or run the included test script
chmod +x test_api.sh
./test_api.sh
```

---

## Running with Docker Compose

If you prefer containers over managing processes manually:

### Backend Only

```bash
cd Dev_Fabric
docker compose up --build
```

This starts **3 containers**: Redis (port 6380), API (port 8001), and Celery worker.

### Frontend Only

```bash
cd Frontend
docker compose up --build
```

This builds the frontend and serves it via Nginx on port **3001**.

### Full Stack (Manual)

```bash
# Terminal 1: Backend
cd Dev_Fabric && docker compose up --build

# Terminal 2: Frontend (point to backend)
cd Frontend && npm run dev
```

---

## Environment Configuration

### Backend — `Dev_Fabric/.env`

```env
# App
APP_NAME="NH AMC Fabric MVP"

# Redis / Celery
REDIS_URL="redis://localhost:6379/0"
BROKER_URL="redis://localhost:6379/0"
RESULT_BACKEND="redis://localhost:6379/0"

# Email reports (optional)
SMTP_HOST="localhost"
SMTP_PORT=25
SMTP_USER=
SMTP_PASS=
SMTP_FROM="no-reply@example.com"
SMTP_STARTTLS=false

# Security — required for /tasks/wp-reset endpoint
RESET_TOKEN="your-secret-token"

# CORS — comma-separated origins or "*"
CORS_ALLOW_ORIGINS="*"
```

### Frontend — `Frontend/.env.development`

```env
VITE_API_BASE_URL=http://localhost:8001
VITE_APP_ENV=development
```

For production builds, update `Frontend/.env`:

```env
VITE_API_BASE_URL=https://amcbackend.hellonotionhive.com
VITE_APP_ENV=production
```

---

## Project Architecture

### Backend (Dev_Fabric)

```
Dev_Fabric/
├── main.py              # FastAPI app — all route definitions
├── celery_app.py        # Celery task definitions
├── fabric_tasks.py      # SSH task implementations (via Fabric)
├── task_runner.py       # SSH connection helpers
├── schemas.py           # Pydantic models (request/response)
├── config.py            # Settings (reads from .env)
├── emailer.py           # SMTP email sender
├── logger.py            # Logging config
├── wp_provision.sh      # WordPress install script (uploaded to remote servers)
├── wp_reset.sh          # Server hard-reset script
├── start.sh             # Docker entrypoint (uvicorn + celery)
├── docker-compose.yml   # Redis + API + Celery containers
└── requirements.txt     # Python deps
```

**How tasks work:**

1. Frontend sends a POST to an API endpoint (e.g., `/tasks/backup`)
2. `main.py` validates the request, enqueues a **Celery task**
3. Returns a `task_id` immediately to the frontend
4. Celery worker picks up the task, executes it via **Fabric** (SSH) or **HTTP** (WP REST API)
5. Frontend polls `GET /tasks/{task_id}` until the task completes
6. Optionally sends an email report with the results

### Frontend

```
Frontend/src/
├── pages/
│   ├── Index.tsx         # Main router — renders the active page
│   └── NotFound.tsx      # 404 page
├── components/
│   ├── pages/            # Feature pages (connections, wp-status, provision, etc.)
│   ├── layout/           # Dashboard shell (sidebar + header)
│   └── ui/               # ShadCN component library (52 components)
├── hooks/
│   ├── use-mobile.tsx    # Responsive breakpoint hook
│   └── use-toast.ts      # Toast notification hook
└── lib/
    ├── api.ts            # API service class — all backend calls
    ├── config.ts         # Environment config (API URL, env mode)
    ├── plugin-normalizer.ts  # Plugin data normalization
    └── utils.ts          # Utility functions
```

**Key conventions:**

- **State-based routing** — `Index.tsx` uses `useState` to switch between pages (not react-router based navigation)
- **ShadCN/UI** — All UI components come from ShadCN (Radix UI + Tailwind). Add new ones with `npx shadcn-ui@latest add <component>`
- **API calls** — All backend communication goes through `src/lib/api.ts` using the `ApiService` class
- **Settings persistence** — API settings (URL, auth) are stored in `localStorage` and managed via the Settings page

---

## Common Development Tasks

### Adding a New API Endpoint

1. **Define schema** — Add Pydantic model in `Dev_Fabric/schemas.py`
2. **Add Celery task** — Define the task in `Dev_Fabric/celery_app.py`
3. **Add Fabric task** (if SSH) — Implement in `Dev_Fabric/fabric_tasks.py`
4. **Add route** — Create the FastAPI route in `Dev_Fabric/main.py`
5. **Add frontend method** — Add the API call in `Frontend/src/lib/api.ts`
6. **Update UI** — Add UI elements in the relevant page component

### Adding a New UI Component (ShadCN)

```bash
cd Frontend
npx shadcn-ui@latest add <component-name>
# Example: npx shadcn-ui@latest add calendar
```

Components are installed to `src/components/ui/`. Configuration is in `components.json`.

### Adding a New Dashboard Page

1. Create a new component in `Frontend/src/components/pages/`
2. Import it in `Frontend/src/pages/Index.tsx`
3. Add a case to the `renderCurrentPage()` switch
4. Add a sidebar navigation item in `Frontend/src/components/layout/dashboard-layout.tsx`

### Testing API Endpoints

```bash
# Use the included test script
./test_api.sh

# Or manually with curl
curl -X POST http://localhost:8001/tasks/wp-status \
  -H "Content-Type: application/json" \
  -d '{
    "host": "your-server-ip",
    "user": "root",
    "private_key_pem": "...",
    "wp_path": "/var/www/html",
    "db_name": "wp_db",
    "db_user": "wp_user",
    "db_pass": "wp_pass"
  }'

# Check task result
curl http://localhost:8001/tasks/{task_id}
```

### Checking Celery Tasks

```bash
# Watch Celery logs
celery -A celery_app worker --loglevel=debug --pool=solo

# Monitor with Flower (optional)
pip install flower
celery -A celery_app flower --port=5555
# Visit http://localhost:5555
```

---

## Build & Production

### Frontend Production Build

```bash
cd Frontend
npm run build          # Production build → dist/
npm run preview        # Preview production build locally
```

### Docker Production Images

```bash
# Frontend → Nginx
cd Frontend
docker build -t nh-amc-frontend .
docker run -p 80:80 nh-amc-frontend

# Backend → Python + Uvicorn + Celery
cd Dev_Fabric
docker compose up --build -d
```

---

## Code Style & Conventions

| Area       | Convention                                                           |
| ---------- | -------------------------------------------------------------------- |
| Python     | Type hints encouraged, Pydantic for all request/response models      |
| TypeScript | Strict mode enabled, interfaces for all API types in `api.ts`        |
| CSS        | Tailwind CSS utilities + ShadCN design tokens (CSS variables)        |
| Naming     | `snake_case` for Python, `camelCase` for TypeScript/React            |
| Imports    | Use `@/` alias for all frontend imports (e.g., `@/components/ui`)    |
| API layer  | All fetch calls go through `ApiService` — never use `fetch` directly |

---

## Troubleshooting

### Redis connection refused

```bash
# Check if Redis is running
redis-cli ping    # Should return PONG

# Start Redis
redis-server &
# Or with Docker
docker run -d -p 6379:6379 redis:7-alpine
```

### Celery worker not picking up tasks

```bash
# Ensure REDIS_URL matches in .env and the running Redis instance
# Restart the worker with debug logging
celery -A celery_app worker --loglevel=debug --pool=solo
```

### Frontend can't reach backend

- Check that `VITE_API_BASE_URL` in `.env.development` points to `http://localhost:8001`
- Verify backend is running: `curl http://localhost:8001/`
- Check browser console for CORS errors — backend allows all origins by default (`CORS_ALLOW_ORIGINS="*"`)

### SSH tasks failing

- Verify the SSH key / password are correct
- Ensure the remote server allows root login or the specified user
- Check Celery worker logs for Fabric/Paramiko errors

### Port conflicts

| Service  | Default Port | Change In                         |
| -------- | ------------ | --------------------------------- |
| Frontend | 8080         | `Frontend/vite.config.ts`         |
| Backend  | 8001         | `Dev_Fabric/start.sh` or CLI args |
| Redis    | 6379         | `Dev_Fabric/.env` → `REDIS_URL`   |
