"""Quotations (quotation.php) and shared documents (resources.php, download.php)."""
from datetime import date
from decimal import Decimal
from typing import List
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.auth import Member, require
from app.config import settings
from app.db import Document, Quotation, QuotationService, audit, get_db

router = APIRouter(prefix="/api/billing", tags=["Quotations & documents"])


class ServiceIn(BaseModel):
    service_name: str = Field(min_length=1, max_length=255)
    amount: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    remarks: str = Field(default="", max_length=1000)


class QuotationIn(BaseModel):
    client_name: str = Field(min_length=1, max_length=255)
    client_phone: str = Field(default="", max_length=60)
    client_email: EmailStr | None = None
    quotation_date: date
    total_amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    payment_terms: str = Field(default="", max_length=1000)
    employee_name: str = Field(min_length=1, max_length=200)
    employee_phone: str = Field(default="", max_length=60)
    employee_email: EmailStr | None = None
    services: List[ServiceIn] = Field(min_length=1, max_length=50)


def quotation_out(q: Quotation, with_services=False) -> dict:
    out = {c.name: getattr(q, c.name) for c in Quotation.__table__.columns}
    if with_services:
        out["services"] = [{"service_name": s.service_name, "amount": s.amount, "remarks": s.remarks} for s in q.services]
    return out


VIEW_QUOTATIONS = require("quotations.create", "quotations.view", any_of=True)


@router.get("/quotations")
def list_quotations(member: Member = Depends(VIEW_QUOTATIONS), db: Session = Depends(get_db)):
    stmt = select(Quotation).order_by(Quotation.id.desc()).limit(500)
    if not member.can("quotations.view"):
        stmt = stmt.where(Quotation.created_by_email == member.email)
    return [quotation_out(q) for q in db.scalars(stmt)]


@router.post("/quotations", status_code=201)
def create_quotation(body: QuotationIn, member: Member = Depends(require("quotations.create")),
                     db: Session = Depends(get_db)):
    q = Quotation(**body.model_dump(exclude={"services", "client_email", "employee_email"}),
                  client_email=body.client_email or "", employee_email=body.employee_email or "",
                  created_by_email=member.email)
    q.services = [QuotationService(**s.model_dump()) for s in body.services]
    db.add(q)
    db.flush()
    audit(db, member.email, "quotation.create", "quotation", q.id, q.client_name)
    db.commit()
    return {"id": q.id}


@router.get("/quotations/{quotation_id}")
def get_quotation(quotation_id: int, member: Member = Depends(VIEW_QUOTATIONS), db: Session = Depends(get_db)):
    q = db.scalar(select(Quotation).where(Quotation.id == quotation_id).options(selectinload(Quotation.services)))
    if not q or not (member.can("quotations.view") or q.created_by_email == member.email):
        raise HTTPException(404, "Quotation not found.")
    return quotation_out(q, with_services=True)


# ---------------------------------------------------------------- documents
def document_out(d: Document) -> dict:
    return {"id": d.id, "original_filename": d.original_filename, "content_type": d.content_type, "size": d.size,
            "uploaded_by_email": d.uploaded_by_email, "created_at": d.created_at}


@router.get("/documents")
def list_documents(member: Member = Depends(require("documents.view")), db: Session = Depends(get_db)):
    return [document_out(d) for d in db.scalars(select(Document).order_by(Document.created_at.desc()))]


@router.post("/documents", status_code=201)
async def upload_document(file: UploadFile = File(...), member: Member = Depends(require("documents.upload")),
                          db: Session = Depends(get_db)):
    limit = settings.MAX_UPLOAD_MB * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"Files can be at most {settings.MAX_UPLOAD_MB} MB.")
    if not data:
        raise HTTPException(422, "The file is empty.")
    name = (file.filename or "file").replace("\\", "/").rsplit("/", 1)[-1][:255] or "file"
    d = Document(original_filename=name, content_type=(file.content_type or "application/octet-stream")[:120],
                 size=len(data), data=data, uploaded_by_email=member.email)
    db.add(d)
    db.flush()
    audit(db, member.email, "document.upload", "document", d.id, name)
    db.commit()
    return document_out(d)


@router.get("/documents/{document_id}/download")
def download_document(document_id: int, member: Member = Depends(require("documents.view")),
                      db: Session = Depends(get_db)):
    d = db.get(Document, document_id)
    if not d:
        raise HTTPException(404, "Document not found.")
    # Always a download, never rendered inline, so an uploaded HTML/SVG file cannot run script.
    return Response(d.data, media_type="application/octet-stream", headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(d.original_filename)}",
        "X-Content-Type-Options": "nosniff",
    })


@router.delete("/documents/{document_id}", status_code=204)
def delete_document(document_id: int, member: Member = Depends(require("documents.delete")),
                    db: Session = Depends(get_db)):
    d = db.get(Document, document_id)
    if not d:
        raise HTTPException(404, "Document not found.")
    audit(db, member.email, "document.delete", "document", d.id, d.original_filename)
    db.delete(d)
    db.commit()
