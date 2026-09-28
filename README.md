# Rex Billing (bill.rexera.in)

The billing module, rebuilt from the legacy PHP app in `../public_html` as a separate
service: React frontend, FastAPI backend, its own database. Sign-in is the main
application's (same accounts, same emailed code); billing roles are separate.

```
frontend/   React 19 + Vite + Tailwind, same design system as Main Rex (ui/ is copied from it)
backend/    FastAPI + SQLAlchemy billing API, migrate_from_php.py, tests
docs/       MIGRATION.md: feature mapping, schema mapping, data migration and cutover runbooks
```

## Run locally

Needs the main API running (it handles sign-in); see `../Main Rex/README.md`.

Backend (port 8020, SQLite file by default):

```powershell
cd backend; python -m venv .venv; .\.venv\Scripts\pip install -r requirements.txt
copy .env.example .env   # set MAIN_API_URL to the main API, e.g. http://localhost:8010
.\.venv\Scripts\python -m uvicorn app.main:app --port 8020
```

Frontend (port 5190):

```powershell
cd frontend; npm install; copy .env.example .env; npm run dev
```

Sign in with a main-app account. The main app's Super Admin gets billing admin access and
can grant roles to everyone else in Settings > Users.

## Roles

| Role | Can |
|---|---|
| Billing Admin | Everything, including deleting tax invoices, editing rates, users, settings, activity log |
| Accountant | Tax invoices (no proformas, no delete), approve requests, payments, customers, reports, export, documents |
| Sales / Billing User | Proforma invoices, invoice requests and quotations of their own, documents |
| Viewer | Read-only tax invoices, payments, customers, reports, quotations, documents |

The API enforces these on every request (`backend/app/auth.py`); the UI only hides what a
role cannot use.

## Tests

```powershell
cd backend; .\.venv\Scripts\python -m pytest -q
```

Covers numbering and GST rules, every role boundary, the request-to-invoice flow, payments
and dashboard figures, and the PHP data migration (including its safety stops).

## Keeping the design in sync

`frontend/src/ui/`, `index.css` and `lib/format.ts` are copies of Main Rex's shared
components (taken 2026-09-23) so this app deploys on its own. If Main Rex's components
change, copy the files across again.
