# Digital Heroes Backend Server

Backend API foundation for **Digital Heroes** platform — combining golf Stableford performance tracking, charity fundraising, and a monthly draw-based prize engine.

---

## 🛠 Tech Stack & Architecture

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (Supabase compatible)
- **Architecture**: Lean Modular Monolith (`routes`, `controllers`, `services`, `middleware`)

---

## 📁 Directory Structure

```
Server/
├── ASSUMPTIONS.md            # Documented business and technical assumptions
├── README.md                 # Setup and run instructions
├── package.json
├── .env.example              # Environment variables template
├── .gitignore
└── src/
    ├── server.js             # Server entry point & process listeners
    ├── app.js                # Express app setup & middleware stack
    ├── config/
    │   └── database.js       # PostgreSQL pool connection
    ├── middleware/
    │   ├── error.middleware.js # Centralized operational & unhandled error handler
    │   └── logger.middleware.js# HTTP request logger (Morgan)
    ├── utils/
    │   └── appError.js       # Custom operational error class
    ├── database/
    │   ├── runMigrations.js  # Migration execution runner script
    │   └── migrations/
    │       └── 001_initial_schema.sql # DDL for all core domain tables
    ├── routes/
    │   └── index.js          # API /api/v1 router mount
    └── modules/              # Modular domain structure
        ├── health/           # Health check endpoint
        ├── auth/
        ├── users/
        ├── subscriptions/
        ├── scores/
        ├── charities/
        ├── draws/
        ├── winners/
        └── admin/
```

---

## 🚀 Setup & Execution Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and configure your database settings:
```bash
cp .env.example .env
```

### 3. Run Database Migrations
Ensure PostgreSQL is running, then execute:
```bash
npm run migrate
```

### 4. Start Server
- Development mode (with `--watch` auto-reloading):
```bash
npm run dev
```
- Production mode:
```bash
npm start
```

---

## 🧪 Testing the Health Endpoint

Verify server startup and database connectivity:
```bash
curl http://localhost:5000/api/v1/health
```

**Response Format:**
```json
{
  "success": true,
  "data": {
    "status": "OK",
    "uptime": 2.45,
    "timestamp": "2026-09-21T12:35:00.000Z",
    "environment": "development",
    "database": {
      "connected": true,
      "dbTimestamp": "2026-09-21T12:35:00.123Z"
    }
  }
}
```
