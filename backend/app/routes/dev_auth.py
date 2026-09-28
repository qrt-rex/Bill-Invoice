"""Dev / standalone authentication routes.

Used when running the billing app without the Main Rex CRM backend.
Provides sign-in, 2FA OTP simulation, and session management.
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import BillingUser, get_db

router = APIRouter(prefix="/api/auth", tags=["Dev Auth"])


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class VerifyIn(BaseModel):
    email: EmailStr
    otp: str


class ResendIn(BaseModel):
    email: EmailStr


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    email: EmailStr
    otp: str
    new_password: str


@router.get("/session-config")
def session_config():
    return {"session_timeout_minutes": 60}


@router.post("/login")
def login(data: LoginIn):
    return {"debug_otp": "123456"}


@router.post("/verify-2fa")
def verify_2fa(data: VerifyIn, db: Session = Depends(get_db)):
    email = data.email.strip().lower()
    # Ensure this user exists in billing_users table as admin so they have full access
    user = db.scalar(select(BillingUser).where(BillingUser.email == email))
    if not user:
        name_parts = email.split("@")[0].replace(".", " ").replace("-", " ").title()
        user = BillingUser(
            email=email,
            full_name=name_parts,
            job_role="Billing Administrator",
            role="admin",
            active=True
        )
        db.add(user)
        db.commit()
    return {"access_token": f"dev-token-{email}"}


@router.post("/resend-2fa-otp")
def resend_otp(data: ResendIn):
    return {"debug_otp": "123456"}


@router.post("/forgot-password")
def forgot_password(data: ForgotIn):
    return {"debug_otp": "123456"}


@router.post("/reset-password")
def reset_password(data: ResetIn):
    return {"status": "ok"}


@router.post("/logout")
def logout():
    return {"status": "ok"}


@router.post("/session-timeout")
def session_timeout():
    return {"status": "ok"}
