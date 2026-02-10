# NH AMC — WordPress Annual Maintenance Contract Platform

A full-stack platform for managing WordPress site **Annual Maintenance Contracts (AMC)**. It automates routine WordPress operations—backups, updates, provisioning, health checks, SSL monitoring—through a modern dashboard backed by an asynchronous task engine.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Services](#services)
  - [Dev_Fabric — Automation Backend](#dev_fabric--automation-backend)
  - [Frontend — Dashboard UI](#frontend--dashboard-ui)
  - [Dev_API — Secondary Backend](#dev_api--secondary-backend)
  - [Dev — Standalone Utility Scripts](#dev--standalone-utility-scripts)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Backend (Dev_Fabric)](#backend-dev_fabric)
  - [Frontend](#frontend)
  - [Docker Compose (Dev_Fabric)](#docker-compose-dev_fabric)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
- [Frontend Pages](#frontend-pages)
- [Docker Deployment](#docker-deployment)

---

## Overview

NH AMC is built for agencies and freelancers who manage multiple WordPress websites under maintenance contracts. It provides:

- **SSH-based server management** — Connect to remote servers via SSH keys or passwords
- **WordPress provisioning** — One-click WordPress installation on remote servers
- **Automated backups** — Database and `wp-content` backups with direct download support
- **Plugin & core updates** — Update plugins/core via WP REST API with rollback on failure
- **SSL & domain monitoring** — WHOIS lookups and SSL certificate expiry checks
- **Health checks** — Uptime monitoring with keyword matching and optional screenshots
- **Hard reset** — Full droplet reset to a clean state (token-protected)
- **Asynchronous task queue** — All long-running operations execute via Celery + Redis
- **Email reports** — Optional SMTP-based report delivery for task results

---

## Architecture

```
┌─────────────────┐       REST API        ┌──────────────────────────┐
│                 │ ────────────────────►  │   Dev_Fabric (FastAPI)   │
│    Frontend     │                       │        Port 8001         │
│  (React/Vite)   │ ◄────────────────────  │                          │
│    Port 80      │       JSON / Files     │   ┌──────────────────┐  │
└─────────────────┘                       │   │   Celery Worker   │  │
                                          │   │   (Fabric/SSH)    │  │
                                          │   └────────┬─────────┘  │
                                          └────────────┼────────────┘
                                                       │
                                          ┌────────────▼────────────┐
                                          │     Redis (Broker)      │
                                          │      Port 6379          │
                                          └─────────────────────────┘
                                                       │
                                          ┌────────────▼────────────┐
                                          │   Remote WP Servers     │
                                          │     (via SSH/REST)      │
                                          └─────────────────────────┘
```

---

## Project Structure

```
NH AMC Product/
├── Dev_Fabric/              # Primary automation backend (FastAPI + Celery + Fabric)
│   ├── main.py              # FastAPI application & route definitions
│   ├── celery_app.py        # Celery task definitions (backup, update, SSL, etc.)
│   ├── fabric_tasks.py      # Fabric SSH task implementations
│   ├── task_runner.py       # SSH connection helpers & task execution
│   ├── schemas.py           # Pydantic request/response models
│   ├── config.py            # Settings via pydantic-settings (.env support)
│   ├── emailer.py           # SMTP email report sender
│   ├── logger.py            # Logging setup
│   ├── wp_provision.sh      # WordPress provisioning shell script
│   ├── wp_reset.sh          # Droplet hard-reset shell script
│   ├── docker-compose.yml   # Docker Compose for API + Celery + Redis
│   ├── Dockerfile           # Python 3.10 container image
│   ├── start.sh             # Entrypoint: runs uvicorn + celery worker
│   └── requirements.txt     # Python dependencies
│
├── Frontend/                # Dashboard UI (React + Vite + TypeScript)
│   ├── src/
│   │   ├── pages/           # Index (main router) & NotFound
│   │   ├── components/
│   │   │   ├── pages/       # Feature pages (connections, wp-status, provision, etc.)
│   │   │   ├── layout/      # Dashboard layout shell
│   │   │   └── ui/          # ShadCN UI component library (52 components)
│   │   ├── hooks/           # Custom React hooks (mobile detection, toast)
│   │   └── lib/             # API service, config, utilities, plugin normalizer
│   ├── Dockerfile           # Multi-stage build (Node 22 → Nginx)
│   ├── package.json         # npm dependencies & scripts
│   └── tailwind.config.ts   # Tailwind CSS configuration
│
├── Dev_API/                 # Secondary backend prototype
│   └── backend/
│       └── app/             # FastAPI app with routes, services, workers, schemas
│
├── Dev/                     # Standalone Python utility scripts
│   ├── Domain_SSL_Checker.py
│   ├── Full_Update_System.py
│   ├── Outdate_Fetch.py
│   ├── Post_Update.py
│   ├── Up&Running.py
│   └── plugins/             # Plugin data directory
│
├── Backend/                 # Scaffold backend (empty, unused)
├── Revamp/                  # Empty — reserved for future refactoring
├── Dockerfile               # Root-level Dockerfile (Vite frontend → Nginx)
└── test_api.sh              # API test script
```

---

## Tech Stack

| Layer          | Technology                                                         |
| -------------- | ------------------------------------------------------------------ |
| **Frontend**   | React 18, TypeScript, Vite 5, Tailwind CSS 3, ShadCN/UI (Radix UI) |
| **Backend**    | Python 3.10, FastAPI, Celery, Fabric, Paramiko                     |
| **Task Queue** | Redis 7                                                            |
| **UI Library** | Radix UI primitives, Recharts, Framer Motion, React Hook Form, Zod |
| **State Mgmt** | TanStack React Query                                               |
| **Deployment** | Docker, Docker Compose, Nginx, Supervisord                         |

---

## Services

### Dev_Fabric — Automation Backend

The primary backend service. A **FastAPI** application serving the REST API with a **Celery** worker executing long-running tasks over **SSH** (via Fabric) or HTTP (WP REST API).

**Key capabilities:**

| Feature               | Description                                               |
| --------------------- | --------------------------------------------------------- |
| SSH Login             | Verify SSH connections and create site sessions           |
| WP Provisioning       | Full WordPress installation on remote servers             |
| WP Status             | Fetch core, plugin, and theme update status               |
| Plugin Updates        | Update individual or all plugins (with blocklist support) |
| Core Updates          | Update WordPress core with pre-check                      |
| Update All            | One-click update for plugins + core combined              |
| Backup (DB)           | Database dump with optional direct download               |
| Backup (Content)      | `wp-content` tar archive with optional direct download    |
| Update with Rollback  | Snapshot → update → auto-rollback on failure              |
| SSL Expiry Check      | Remote SSL certificate expiry detection                   |
| Domain/SSL Collection | WHOIS + SSL data aggregation (runs locally)               |
| Health Check          | HTTP uptime check with keyword matching & screenshots     |
| Hard Reset            | Full droplet wipe via shell script (token-protected)      |
| WP Outdated Fetch     | Detect outdated plugins/themes via WP REST API            |

### Frontend — Dashboard UI

A **React + TypeScript** single-page application built with **Vite** and styled using **Tailwind CSS** and **ShadCN/UI** (52 Radix-based components). It communicates with the Dev_Fabric backend.

**Dashboard pages:**

- **Connections** — SSH connection manager (add/verify servers)
- **WP Status** — WordPress site health & update status overview
- **Provision** — One-click WordPress installation wizard
- **Operations** — Manage backups, updates, SSL checks, resets
- **Tasks** — Async task queue monitor (poll Celery task results)
- **Settings** — API base URL, authentication, and header configuration

### Dev_API — Secondary Backend

A prototype/development backend with a similar FastAPI structure including routes, services, workers, and shell scripts for WordPress provisioning and reset. Contains its own Docker Compose configuration.

### Dev — Standalone Utility Scripts

Independent Python scripts for quick manual tasks:

- `Domain_SSL_Checker.py` — Check domain SSL certificates
- `Full_Update_System.py` — Full WordPress update pipeline
- `Outdate_Fetch.py` — Fetch outdated plugin/theme information
- `Post_Update.py` — Post-update verification
- `Up&Running.py` — Uptime/availability check

---

## Getting Started

### Prerequisites

- **Python** 3.10+
- **Node.js** 22+ and **npm**
- **Redis** 7+
- **Docker** & **Docker Compose** (optional, for containerized deployment)

### Backend (Dev_Fabric)

```bash
# Navigate to the backend
cd Dev_Fabric

# Create a virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy and configure environment
cp .env.example .env   # or edit the existing .env

# Start the FastAPI server
uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# In a separate terminal, start the Celery worker
celery -A celery_app worker --loglevel=info --pool=solo
```

> **Note:** Redis must be running on `localhost:6379` (or update `REDIS_URL` in `.env`).

### Frontend

```bash
# Navigate to the frontend
cd Frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

The frontend dev server will start on `http://localhost:5173` by default.

### Docker Compose (Dev_Fabric)

```bash
cd Dev_Fabric

# Start all services (API + Celery + Redis)
docker compose up --build
```

This brings up:

- **Redis** on port `6380` (mapped from `6379`)
- **API** on port `8001`
- **Celery worker** connected to Redis

---

## Environment Variables

### Dev_Fabric (`.env`)

| Variable             | Description                                 | Default                    |
| -------------------- | ------------------------------------------- | -------------------------- |
| `APP_NAME`           | Application name                            | `NH AMC Fabric MVP`        |
| `REDIS_URL`          | Redis connection URL                        | `redis://localhost:6379/0` |
| `BROKER_URL`         | Celery broker URL (falls back to REDIS_URL) | —                          |
| `RESULT_BACKEND`     | Celery result backend URL                   | —                          |
| `SMTP_HOST`          | SMTP server hostname                        | `localhost`                |
| `SMTP_PORT`          | SMTP server port                            | `25`                       |
| `SMTP_USER`          | SMTP authentication username                | —                          |
| `SMTP_PASS`          | SMTP authentication password                | —                          |
| `SMTP_FROM`          | Sender email address                        | `no-reply@example.com`     |
| `SMTP_STARTTLS`      | Enable STARTTLS                             | `false`                    |
| `RESET_TOKEN`        | Secret token for `/tasks/wp-reset`          | —                          |
| `CORS_ALLOW_ORIGINS` | Comma-separated allowed origins             | `*`                        |

### Frontend (`.env`)

| Variable            | Description             | Default                                  |
| ------------------- | ----------------------- | ---------------------------------------- |
| `VITE_API_BASE_URL` | Backend API base URL    | `https://amcbackend.hellonotionhive.com` |
| `VITE_APP_ENV`      | Application environment | `production`                             |

---

## API Endpoints

Base URL: `http://localhost:8001`

| Method | Endpoint                      | Description                                  |
| ------ | ----------------------------- | -------------------------------------------- |
| GET    | `/`                           | Service health check                         |
| POST   | `/ssh/login`                  | Verify SSH credentials & create site session |
| GET    | `/sites/{site_id}`            | Get site info by session ID                  |
| POST   | `/tasks/backup`               | Trigger full site backup                     |
| POST   | `/tasks/backup/db`            | Backup database (with optional download)     |
| POST   | `/tasks/backup/content`       | Backup wp-content (with optional download)   |
| POST   | `/tasks/wp-status`            | Get WordPress core/plugin/theme status       |
| POST   | `/tasks/update`               | Update with automatic rollback               |
| POST   | `/tasks/ssl-expiry`           | Check SSL certificate expiry                 |
| POST   | `/tasks/healthcheck`          | Run HTTP health check                        |
| POST   | `/tasks/wp-install/{site_id}` | Provision WordPress on a remote server       |
| POST   | `/tasks/wp-reset`             | Hard reset droplet (token-protected)         |
| POST   | `/tasks/domain-ssl-collect`   | Collect WHOIS + SSL data                     |
| POST   | `/tasks/wp-outdated-fetch`    | Fetch outdated plugin/theme info             |
| POST   | `/tasks/wp-update/plugins`    | Update WordPress plugins                     |
| POST   | `/tasks/wp-update/core`       | Update WordPress core                        |
| POST   | `/tasks/wp-update/all`        | Update all (plugins + core)                  |
| GET    | `/tasks/{task_id}`            | Poll async task status & results             |

---

## Frontend Pages

| Page        | Description                                                            |
| ----------- | ---------------------------------------------------------------------- |
| Connections | Manage SSH connections to remote servers (host, user, key/password)    |
| WP Status   | Dashboard showing WordPress core, plugin, and theme update status      |
| Provision   | Wizard for one-click WordPress installation on a connected server      |
| Operations  | Trigger backups, updates, SSL checks, health checks, and hard resets   |
| Tasks       | Monitor running/completed Celery tasks with real-time status polling   |
| Settings    | Configure API URL, default authentication, custom headers, reset token |

---

## Docker Deployment

### Frontend (Production)

```bash
cd Frontend
docker build -t nh-amc-frontend .
docker run -p 80:80 nh-amc-frontend
```

### Backend (Dev_Fabric)

```bash
cd Dev_Fabric
docker compose up --build -d
```

### Full Stack (Root Dockerfile)

The root `Dockerfile` builds the frontend as a Vite app and serves it via Nginx on port **81**:

```bash
docker build -t nh-amc-app .
docker run -p 81:81 nh-amc-app
```

---

## License

This is a private project. All rights reserved.
