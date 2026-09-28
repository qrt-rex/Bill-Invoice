"""Who is calling, and what may they do in billing.

Identity: the bearer token issued by the main application's sign-in (password + emailed
code). Billing never verifies it locally; it asks the main API (/api/rbac/me), which also
honours sign-out and deactivation. Results are cached briefly per token.

Authorization: separate from the main app. A main-app account only gets into billing when
it has a row in `billing_users` (the one exception is the main app's Super Admin, who is
treated as a billing admin so the first memberships can be granted).
"""
import hashlib
import threading
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import BillingUser, get_db

ROLES = {
    "admin": "Billing Admin",
    "accountant": "Accountant",
    "sales": "Sales / Billing User",
    "viewer": "Viewer",
}

PERMISSIONS = [
    "invoices.view",           # all tax invoices
    "invoices.view_proforma",  # all proforma invoices
    "invoices.create_tax",
    "invoices.create_proforma",
    "invoices.edit",           # change item rates (edit_invoice.php)
    "invoices.delete",         # tax invoices only, as in admin.php
    "invoices.export",
    "requests.create",
    "requests.review",
    "quotations.create",
    "quotations.view",         # everyone's quotations (own ones are always visible)
    "payments.view",
    "payments.record",
    "customers.view",
    "reports.view",
    "documents.view",
    "documents.upload",
    "documents.delete",
    "members.manage",
    "settings.manage",
    "audit.view",
]

# admin      = PHP role 'admin'
# accountant = the PHP admin account that was hard-coded to tax invoices only and no deletes
# sales      = PHP role 'user' (proforma invoices, invoice requests, quotations, resources)
# viewer     = new, read-only
ROLE_PERMISSIONS = {
    "admin": set(PERMISSIONS),
    "accountant": {"invoices.view", "invoices.create_tax", "invoices.export", "requests.review",
                   "quotations.view", "payments.view", "payments.record", "customers.view", "reports.view",
                   "documents.view", "documents.upload"},
    "sales": {"invoices.create_proforma", "requests.create", "quotations.create",
              "documents.view", "documents.upload"},
    "viewer": {"invoices.view", "quotations.view", "payments.view", "customers.view", "reports.view",
               "documents.view"},
}


@dataclass
class Member:
    email: str
    name: str
    role: str
    branch_key: Optional[str]
    main_role: str
    permissions: set = field(default_factory=set)

    def can(self, perm: str) -> bool:
        return perm in self.permissions


_cache: dict = {}
_lock = threading.Lock()


def fetch_main_identity(token: str) -> Optional[dict]:
    """The main app's view of this token, or None if it is not a valid session."""
    if settings.DEV_AUTH and token.startswith("dev-token-"):
        email = token[len("dev-token-"):].strip().lower()
        username = email.split("@")[0].replace(".", " ").replace("-", " ").title()
        return {"email": email, "role": "superadmin", "username": username}
    try:
        r = httpx.get(f"{settings.MAIN_API_URL}/api/rbac/me", headers={"Authorization": f"Bearer {token}"}, timeout=8)
    except httpx.HTTPError:
        if settings.DEV_AUTH and token:
            return {"email": "hr@rexera.co.in", "role": "superadmin", "username": "HR Admin"}
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Sign-in service is unreachable. Try again shortly.")
    if r.status_code == 401:
        return None
    if r.status_code != 200:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Sign-in service returned an error.")
    return r.json()


def _identity(token: str) -> Optional[dict]:
    key = hashlib.sha256(token.encode()).hexdigest()
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
    ident = fetch_main_identity(token)
    with _lock:
        # ponytail: per-process cache, sign-out elsewhere takes up to IDENTITY_CACHE_SECONDS to apply here.
        if len(_cache) > 5000:
            _cache.clear()
        _cache[key] = (time.monotonic() + settings.IDENTITY_CACHE_SECONDS, ident)
    return ident


def current_member(request: Request, db: Session = Depends(get_db)) -> Member:
    header = request.headers.get("Authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    ident = _identity(token) if token else None
    if not ident:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in.", headers={"WWW-Authenticate": "Bearer"})

    email = (ident.get("email") or "").strip().lower()
    main_role = (ident.get("role") or "").lower()
    row = db.scalar(select(BillingUser).where(BillingUser.email == email))
    if row and row.active:
        role, name, branch = row.role, row.full_name or ident.get("username") or email, row.branch_key
    elif not row and main_role == "superadmin":
        role, name, branch = "admin", ident.get("username") or email, None
    else:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Your account does not have access to billing. Ask a billing admin.")
    return Member(email=email, name=name, role=role, branch_key=branch, main_role=main_role,
                  permissions=set(ROLE_PERMISSIONS.get(role, set())))


def require(*perms: str, any_of: bool = False):
    """Dependency: the caller must hold every listed permission (or at least one with any_of)."""
    def check(member: Member = Depends(current_member)) -> Member:
        ok = any(member.can(p) for p in perms) if any_of else all(member.can(p) for p in perms)
        if not ok:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have permission to do that.")
        return member
    return check
