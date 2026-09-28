"""Rexera Billing API (api.bill.rexera.in). Separate service and database from the main app."""
import logging
import threading
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.db import init_db
from app.routes import admin, insights, invoices, records

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Rexera Billing API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition"],
)

_hits: dict = defaultdict(deque)
_hits_lock = threading.Lock()


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    # ponytail: in-memory per-IP window, per process; use the proxy's limiter if this runs on several workers.
    # The last X-Forwarded-For entry is the one our proxy added; earlier ones are client-supplied.
    ip = request.headers.get("x-forwarded-for", "").split(",")[-1].strip() or (request.client.host if request.client else "")
    now = time.monotonic()
    with _hits_lock:
        q = _hits[ip]
        while q and q[0] < now - 60:
            q.popleft()
        if len(q) >= settings.RATE_LIMIT_PER_MINUTE:
            return JSONResponse({"detail": "Too many requests. Please slow down."}, status_code=429)
        q.append(now)
    return await call_next(request)


for module in (admin, invoices, insights, records):
    app.include_router(module.router)

if settings.DEV_AUTH:
    from app.routes import dev_auth
    app.include_router(dev_auth.router)


@app.get("/api/health", tags=["Health"])
def health():
    return {"status": "healthy", "service": "billing"}
