"""Session info, reference data, billing memberships (admin.php user management), settings, audit."""
from typing import Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import rules
from app.auth import PERMISSIONS, ROLES, Member, current_member, require
from app.db import DEFAULT_SETTINGS, AuditLog, BillingUser, Branch, Setting, audit, get_db, settings_map
from app.routes.invoices import PAYMENT_MODES

router = APIRouter(prefix="/api/billing", tags=["Administration"])

Role = Literal["admin", "accountant", "sales", "viewer"]


@router.get("/me")
def me(member: Member = Depends(current_member)):
    return {"email": member.email, "name": member.name, "role": member.role, "role_label": ROLES[member.role],
            "branch_key": member.branch_key, "permissions": sorted(member.permissions)}


@router.get("/meta")
def meta(member: Member = Depends(current_member), db: Session = Depends(get_db)):
    """Reference data every form needs: branches, company/bank defaults, states."""
    return {
        "branches": [{c.name: getattr(b, c.name) for c in Branch.__table__.columns} for b in db.scalars(select(Branch))],
        "settings": settings_map(db),
        "states": rules.INDIAN_STATES,
        "home_state": rules.HOME_STATE,
        "payment_modes": PAYMENT_MODES,
        "roles": [{"id": k, "label": v} for k, v in ROLES.items()],
    }


# ---------------------------------------------------------------- memberships
class MemberIn(BaseModel):
    email: EmailStr
    full_name: str = Field(default="", max_length=200)
    job_role: str = Field(default="", max_length=100)
    role: Role
    branch_key: Optional[str] = None
    active: bool = True


class MemberPatch(BaseModel):
    full_name: Optional[str] = Field(default=None, max_length=200)
    job_role: Optional[str] = Field(default=None, max_length=100)
    role: Optional[Role] = None
    branch_key: Optional[str] = None
    active: Optional[bool] = None


def member_out(u: BillingUser) -> dict:
    return {c.name: getattr(u, c.name) for c in BillingUser.__table__.columns}


def check_branch(db: Session, key: Optional[str]) -> None:
    if key and not db.get(Branch, key):
        raise HTTPException(422, "Unknown branch.")


@router.get("/members")
def list_members(member: Member = Depends(require("members.manage")), db: Session = Depends(get_db)):
    return {"roles": [{"id": k, "label": v} for k, v in ROLES.items()], "permissions": PERMISSIONS,
            "items": [member_out(u) for u in db.scalars(select(BillingUser).order_by(BillingUser.full_name))]}


@router.post("/members", status_code=201)
def add_member(body: MemberIn, member: Member = Depends(require("members.manage")), db: Session = Depends(get_db)):
    """Grants billing access to an existing main-application account (it signs in there)."""
    check_branch(db, body.branch_key)
    u = BillingUser(**{**body.model_dump(), "email": body.email.lower()})
    db.add(u)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(409, "That email already has billing access.")
    audit(db, member.email, "member.add", "member", u.id, f"{u.email} as {u.role}")
    db.commit()
    return member_out(u)


@router.patch("/members/{member_id}")
def update_member(member_id: int, body: MemberPatch, member: Member = Depends(require("members.manage")),
                  db: Session = Depends(get_db)):
    u = db.get(BillingUser, member_id)
    if not u:
        raise HTTPException(404, "Member not found.")
    changes = body.model_dump(exclude_unset=True)
    if u.email == member.email and (changes.get("active") is False or changes.get("role", "admin") != "admin"):
        raise HTTPException(422, "You cannot remove your own admin access.")  # admin.php: no self-delete
    check_branch(db, changes.get("branch_key"))
    for k, v in changes.items():
        setattr(u, k, v)
    audit(db, member.email, "member.update", "member", u.id, f"{u.email}: {changes}")
    db.commit()
    return member_out(u)


# ---------------------------------------------------------------- settings
class BranchIn(BaseModel):
    display_name: str = Field(min_length=1, max_length=80)
    legal_name: str = Field(min_length=1, max_length=200)
    address: str = Field(min_length=1, max_length=1000)
    phone: str = Field(min_length=1, max_length=40)


@router.put("/settings")
def update_settings(body: Dict[str, str], member: Member = Depends(require("settings.manage")),
                    db: Session = Depends(get_db)):
    unknown = set(body) - set(DEFAULT_SETTINGS)
    if unknown:
        raise HTTPException(422, f"Unknown settings: {', '.join(sorted(unknown))}")
    for k, v in body.items():
        db.merge(Setting(key=k, value=v.strip()[:500]))
    audit(db, member.email, "settings.update", "settings", "", ", ".join(sorted(body)))
    db.commit()
    return settings_map(db)


@router.put("/branches/{key}")
def update_branch(key: str, body: BranchIn, member: Member = Depends(require("settings.manage")),
                  db: Session = Depends(get_db)):
    b = db.get(Branch, key)
    if not b:
        raise HTTPException(404, "Branch not found.")
    for k, v in body.model_dump().items():
        setattr(b, k, v.strip())
    audit(db, member.email, "branch.update", "branch", key, b.display_name)
    db.commit()
    return {c.name: getattr(b, c.name) for c in Branch.__table__.columns}


@router.get("/audit")
def audit_log(page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200),
              member: Member = Depends(require("audit.view")), db: Session = Depends(get_db)):
    total = db.scalar(select(func.count(AuditLog.id)))
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size))
    return {"total": total, "page": page, "page_size": page_size,
            "items": [{c.name: getattr(r, c.name) for c in AuditLog.__table__.columns} for r in rows]}
