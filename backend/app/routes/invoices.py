"""Invoices (tax + proforma), payments and invoice requests.

Legacy PHP pages covered: invoice.php, generate_invoice.php, save_invoice.php, view_invoice.php,
edit_invoice.php, admin.php (list/delete/reject), search_invoices.php, export_invoices.php,
ajax_get_invoice_number.php, ajax_get_invoices_by_date.php, bulk_invoice_*.php,
request_invoice.php, approve_invoice.php.
"""
import csv
import io
import json
from datetime import date, datetime
from decimal import Decimal
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app import rules
from app.auth import Member, current_member, require
from app.db import Branch, Invoice, InvoiceItem, InvoiceRequest, InvoiceRequestItem, Payment, audit, get_db

router = APIRouter(prefix="/api/billing", tags=["Invoices"])

PAYMENT_MODES = ["Bank transfer", "UPI", "Cheque", "Cash", "Card", "Other"]


# ---------------------------------------------------------------- input models
class ItemIn(BaseModel):
    particulars: str = Field(min_length=1, max_length=500)
    hsn: str = Field(default="", max_length=20)
    quantity: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    rate: Decimal = Field(ge=0, max_digits=14, decimal_places=2)


class PartyIn(BaseModel):
    billing_name: str = Field(min_length=1, max_length=255)
    billing_address: str = Field(min_length=1, max_length=2000)
    billing_phone: str = Field(default="", max_length=60)
    client_gstin: str = Field(default="", max_length=20)
    client_state: str = Field(default="", max_length=80)
    branch_key: str
    remark: str = Field(default="", max_length=2000)

    @field_validator("billing_name", "billing_address", "billing_phone", "remark")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("client_gstin")
    @classmethod
    def gstin(cls, v: str) -> str:
        v = v.strip().upper()
        if v and not rules.GSTIN_RE.match(v):
            raise ValueError("GSTIN is not in the valid 15-character format")
        return v

    @field_validator("client_state")
    @classmethod
    def state(cls, v: str) -> str:
        if v and v not in rules.INDIAN_STATES:
            raise ValueError("Unknown state")
        return v


class InvoiceIn(PartyIn):
    invoice_type: Literal["invoice", "proforma"]
    invoice_date: date
    apply_gst: bool = True
    bank_account_name: str = Field(default="", max_length=200)
    bank_account_number: str = Field(default="", max_length=60)
    bank_ifsc_code: str = Field(default="", max_length=30)
    bank_upi_id: str = Field(default="", max_length=100)
    items: List[ItemIn] = Field(min_length=1, max_length=100)
    request_id: Optional[int] = None


class RateIn(BaseModel):
    id: int
    rate: Decimal = Field(ge=0, max_digits=14, decimal_places=2)


class RatesIn(BaseModel):
    items: List[RateIn] = Field(min_length=1)


class PaymentIn(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    paid_on: date
    mode: str
    reference: str = Field(default="", max_length=120)
    note: str = Field(default="", max_length=1000)

    @field_validator("mode")
    @classmethod
    def known_mode(cls, v: str) -> str:
        if v not in PAYMENT_MODES:
            raise ValueError("Unknown payment mode")
        return v


class RequestIn(PartyIn):
    items: List[ItemIn] = Field(min_length=1, max_length=100)


# ---------------------------------------------------------------- helpers
def visible(member: Member):
    """Which invoices this caller may see: whole types by permission, plus their own."""
    clauses = [Invoice.created_by_email == member.email]
    if member.can("invoices.view"):
        clauses.append(Invoice.invoice_type == "invoice")
    if member.can("invoices.view_proforma"):
        clauses.append(Invoice.invoice_type == "proforma")
    return or_(*clauses)


def load_invoice(db: Session, invoice_id: int, member: Member) -> Invoice:
    inv = db.scalar(select(Invoice).where(Invoice.id == invoice_id, visible(member))
                    .options(selectinload(Invoice.items), selectinload(Invoice.payments)))
    if not inv:
        raise HTTPException(404, "Invoice not found.")
    return inv


def paid_of(inv: Invoice) -> Decimal:
    return sum((p.amount for p in inv.payments), Decimal("0"))


def summary(inv: Invoice) -> dict:
    paid = paid_of(inv)
    return {
        "id": inv.id, "invoice_number": inv.invoice_number, "invoice_type": inv.invoice_type,
        "invoice_date": inv.invoice_date, "billing_name": inv.billing_name, "branch_key": inv.branch_key,
        "client_gstin": inv.client_gstin, "grand_total": inv.grand_total, "paid": paid,
        "balance": inv.grand_total - paid if inv.invoice_type == "invoice" else Decimal("0"),
        "payment_status": rules.payment_status(inv), "created_by_name": inv.created_by_name,
    }


def detail(inv: Invoice) -> dict:
    cols = {c.name: getattr(inv, c.name) for c in Invoice.__table__.columns}
    return {
        **cols, **summary(inv),
        "items": [{"id": i.id, "particulars": i.particulars, "hsn": i.hsn, "quantity": i.quantity,
                   "rate": i.rate, "amount": i.amount} for i in inv.items],
        "payments": [payment_out(p) for p in inv.payments],
    }


def payment_out(p: Payment, inv: Optional[Invoice] = None) -> dict:
    out = {"id": p.id, "invoice_id": p.invoice_id, "amount": p.amount, "paid_on": p.paid_on, "mode": p.mode,
           "reference": p.reference, "note": p.note, "recorded_by_email": p.recorded_by_email}
    if inv:
        out.update(invoice_number=inv.invoice_number, billing_name=inv.billing_name)
    return out


def get_branch(db: Session, key: str) -> Branch:
    branch = db.get(Branch, key)
    if not branch:
        raise HTTPException(422, "Unknown branch.")
    return branch


def next_number(db: Session, invoice_type: str, branch: Branch, on: date) -> str:
    if invoice_type == "proforma":
        last = db.scalar(select(Invoice.invoice_number).where(Invoice.invoice_type == "proforma")
                         .order_by(Invoice.id.desc()).limit(1))
        candidate = rules.next_proforma_number(last)
    else:
        new_like, old_like = rules.tax_invoice_patterns(branch.prefix, on)
        existing = db.scalars(select(Invoice.invoice_number).where(
            Invoice.invoice_type == "invoice",
            or_(Invoice.invoice_number.like(new_like), Invoice.invoice_number.like(old_like))))
        candidate = rules.next_tax_invoice_number(branch.prefix, on, existing)
    # Skip numbers already taken (as the PHP did), e.g. by a manually corrected row.
    while db.scalar(select(Invoice.id).where(Invoice.invoice_number == candidate)):
        head, _, seq = candidate.rpartition("-")
        candidate = f"{head}-{int(seq) + 1:0{len(seq)}d}"
    return candidate


def csv_response(rows: List[list], filename: str) -> Response:
    buf = io.StringIO()
    writer = csv.writer(buf)
    for r in rows:
        # Neutralise spreadsheet formulas in user-entered text.
        writer.writerow([f"'{c}" if isinstance(c, str) and c[:1] in ("=", "+", "-", "@") else c for c in r])
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ---------------------------------------------------------------- invoices
@router.get("/invoices")
def list_invoices(
    type: Optional[Literal["invoice", "proforma"]] = None,
    q: str = "", date_from: Optional[date] = None, date_to: Optional[date] = None,
    branch_key: Optional[str] = None,
    payment_status: Optional[Literal["unpaid", "partial", "paid", "not_tracked"]] = None,
    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
    member: Member = Depends(current_member), db: Session = Depends(get_db),
):
    stmt = select(Invoice).where(visible(member))
    if type:
        stmt = stmt.where(Invoice.invoice_type == type)
    if q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Invoice.invoice_number.ilike(like), Invoice.billing_name.ilike(like),
                              Invoice.client_gstin.ilike(like)))
    if date_from:
        stmt = stmt.where(Invoice.invoice_date >= date_from)
    if date_to:
        stmt = stmt.where(Invoice.invoice_date <= date_to)
    if branch_key:
        stmt = stmt.where(Invoice.branch_key == branch_key)
    stmt = stmt.options(selectinload(Invoice.payments)).order_by(Invoice.id.desc())

    if payment_status:
        # ponytail: status is derived from payments, so this filter scans in Python; fine for tens of thousands of rows.
        rows = [i for i in db.scalars(stmt) if rules.payment_status(i) == payment_status]
        total, rows = len(rows), rows[(page - 1) * page_size: page * page_size]
    else:
        total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery()))
        rows = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return {"total": total, "page": page, "page_size": page_size, "items": [summary(i) for i in rows]}


@router.get("/invoices/next-number")
def preview_number(invoice_type: Literal["invoice", "proforma"], branch_key: str, invoice_date: date,
                   member: Member = Depends(current_member), db: Session = Depends(get_db)):
    """Shown on the form only; the number is assigned for real when the invoice is saved."""
    return {"invoice_number": next_number(db, invoice_type, get_branch(db, branch_key), invoice_date)}


@router.get("/invoices/export")
def export_invoices(type: Literal["invoice", "proforma"],
                    member: Member = Depends(require("invoices.export")), db: Session = Depends(get_db)):
    """export_invoices.php, same columns."""
    invs = db.scalars(select(Invoice).where(Invoice.invoice_type == type, visible(member)).order_by(Invoice.id.desc()))
    rows = [["ID", "Invoice Number", "Type", "Date", "Billing Name", "Billing Address", "Phone Num", "GSTIN",
             "UPI", "Sub Total", "CGST", "SGST", "IGST", "Grand Total", "Remark", "Generated By"]]
    rows += [[i.id, i.invoice_number, i.invoice_type.capitalize(), i.invoice_date.isoformat(), i.billing_name,
              i.billing_address, i.billing_phone, i.client_gstin, i.bank_upi_id, i.sub_total, i.cgst_amount,
              i.sgst_amount, i.igst_amount, i.grand_total, i.remark, i.created_by_name] for i in invs]
    return csv_response(rows, f"{type}_invoices_{date.today().isoformat()}.csv")


@router.get("/invoices/batch")
def invoice_batch(date_from: date, date_to: date,
                  member: Member = Depends(require("invoices.view")), db: Session = Depends(get_db)):
    """Every tax invoice in a date range with items, for one-click bulk printing
    (replaces bulk_invoice_date_range.php's ZIP of PNGs)."""
    if date_from > date_to:
        raise HTTPException(422, "From date cannot be after To date.")
    invs = db.scalars(select(Invoice).where(Invoice.invoice_type == "invoice", Invoice.invoice_date >= date_from,
                                            Invoice.invoice_date <= date_to)
                      .options(selectinload(Invoice.items), selectinload(Invoice.payments))
                      .order_by(Invoice.invoice_date, Invoice.id).limit(501)).all()
    if len(invs) > 500:
        raise HTTPException(422, "More than 500 invoices in that range. Choose a shorter range.")
    return [detail(i) for i in invs]


@router.post("/invoices", status_code=201)
def create_invoice(body: InvoiceIn, member: Member = Depends(current_member), db: Session = Depends(get_db)):
    perm = "invoices.create_tax" if body.invoice_type == "invoice" else "invoices.create_proforma"
    if not member.can(perm):
        raise HTTPException(403, "You don't have permission to create this type of invoice.")
    if body.apply_gst and not body.client_state:
        raise HTTPException(422, "Select the client's state to apply GST.")
    branch = get_branch(db, body.branch_key)

    req = None
    if body.request_id is not None:
        if not member.can("requests.review") or body.invoice_type != "invoice":
            raise HTTPException(403, "Only reviewers can turn a request into a tax invoice.")
        req = db.get(InvoiceRequest, body.request_id)
        if not req or req.status != "pending":
            raise HTTPException(409, "That request is no longer pending.")

    t = rules.compute_totals([(i.quantity, i.rate) for i in body.items], body.apply_gst, body.client_state)
    fields = body.model_dump(exclude={"items", "apply_gst", "request_id"})
    for attempt in range(5):
        inv = Invoice(**fields, invoice_number=next_number(db, body.invoice_type, branch, body.invoice_date),
                      created_by_email=member.email, created_by_name=member.name,
                      **{k: v for k, v in t.items() if k != "amounts"})
        inv.items = [InvoiceItem(position=n, particulars=i.particulars.strip(), hsn=i.hsn.strip(), quantity=i.quantity,
                                 rate=i.rate, amount=a) for n, (i, a) in enumerate(zip(body.items, t["amounts"]))]
        db.add(inv)
        try:
            db.flush()
            break
        except IntegrityError:  # two people saved at the same moment and got the same number
            db.rollback()
            if req is not None:
                req = db.get(InvoiceRequest, body.request_id)
    else:
        raise HTTPException(409, "Could not assign an invoice number. Please try again.")

    if req:
        req.status, req.reviewed_by_email, req.reviewed_at, req.invoice_id = "approved", member.email, datetime.utcnow(), inv.id
        inv.request_id = req.id
    audit(db, member.email, "invoice.create", "invoice", inv.id, f"{inv.invoice_number} · {inv.grand_total}")
    db.commit()
    return {"id": inv.id, "invoice_number": inv.invoice_number}


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: int, member: Member = Depends(current_member), db: Session = Depends(get_db)):
    return detail(load_invoice(db, invoice_id, member))


@router.patch("/invoices/{invoice_id}/rates")
def update_rates(invoice_id: int, body: RatesIn, member: Member = Depends(require("invoices.edit")),
                 db: Session = Depends(get_db)):
    """edit_invoice.php: change item rates; taxes are recomputed with the invoice's existing rates."""
    inv = load_invoice(db, invoice_id, member)
    if inv.invoice_type != "invoice":
        raise HTTPException(422, "Only tax invoices can be edited.")
    by_id = {i.id: i for i in inv.items}
    before = {i.id: str(i.rate) for i in inv.items}
    for r in body.items:
        if r.id not in by_id:
            raise HTTPException(422, "Item does not belong to this invoice.")
        by_id[r.id].rate = r.rate
    for i in inv.items:
        i.amount = rules.money(i.quantity * i.rate)
    inv.sub_total = sum((i.amount for i in inv.items), Decimal("0"))
    inv.cgst_amount = rules.money(inv.sub_total * inv.cgst_rate / 100)
    inv.sgst_amount = rules.money(inv.sub_total * inv.sgst_rate / 100)
    inv.igst_amount = rules.money(inv.sub_total * inv.igst_rate / 100)
    inv.grand_total = inv.sub_total + inv.cgst_amount + inv.sgst_amount + inv.igst_amount
    if paid_of(inv) > inv.grand_total:
        raise HTTPException(422, "The new total is less than the payments already recorded.")
    audit(db, member.email, "invoice.edit_rates", "invoice", inv.id,
          json.dumps({"before": before, "after": {i.id: str(i.rate) for i in inv.items}, "grand_total": str(inv.grand_total)}))
    db.commit()
    return detail(inv)


@router.delete("/invoices/{invoice_id}", status_code=204)
def delete_invoice(invoice_id: int, member: Member = Depends(require("invoices.delete")), db: Session = Depends(get_db)):
    """admin.php?action=delete_invoice: tax invoices only. A full snapshot goes to the audit log."""
    inv = load_invoice(db, invoice_id, member)
    if inv.invoice_type != "invoice":
        raise HTTPException(422, "Only tax invoices can be deleted.")
    audit(db, member.email, "invoice.delete", "invoice", inv.id, json.dumps(detail(inv), default=str))
    db.delete(inv)
    db.commit()


# ---------------------------------------------------------------- payments
@router.get("/payments")
def list_payments(date_from: Optional[date] = None, date_to: Optional[date] = None,
                  page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                  member: Member = Depends(require("payments.view")), db: Session = Depends(get_db)):
    where = []
    if date_from:
        where.append(Payment.paid_on >= date_from)
    if date_to:
        where.append(Payment.paid_on <= date_to)
    total, total_amount = db.execute(select(func.count(Payment.id), func.coalesce(func.sum(Payment.amount), 0)).where(*where)).one()
    rows = db.execute(select(Payment, Invoice).join(Invoice, Invoice.id == Payment.invoice_id).where(*where)
                      .order_by(Payment.paid_on.desc(), Payment.id.desc())
                      .offset((page - 1) * page_size).limit(page_size)).all()
    return {"total": total, "total_amount": total_amount, "page": page, "page_size": page_size,
            "modes": PAYMENT_MODES, "items": [payment_out(p, i) for p, i in rows]}


@router.post("/invoices/{invoice_id}/payments", status_code=201)
def record_payment(invoice_id: int, body: PaymentIn, member: Member = Depends(require("payments.record")),
                   db: Session = Depends(get_db)):
    inv = load_invoice(db, invoice_id, member)
    if inv.invoice_type != "invoice":
        raise HTTPException(422, "Payments are recorded against tax invoices.")
    if body.amount > inv.grand_total - paid_of(inv):
        raise HTTPException(422, "Amount is more than the balance due on this invoice.")
    p = Payment(invoice_id=inv.id, recorded_by_email=member.email, **body.model_dump())
    inv.payment_tracked = True
    db.add(p)
    db.flush()
    audit(db, member.email, "payment.record", "invoice", inv.id, f"{inv.invoice_number} · {body.amount} · {body.mode}")
    db.commit()
    return payment_out(p, inv)


@router.delete("/payments/{payment_id}", status_code=204)
def delete_payment(payment_id: int, member: Member = Depends(require("payments.record")), db: Session = Depends(get_db)):
    p = db.get(Payment, payment_id)
    if not p:
        raise HTTPException(404, "Payment not found.")
    audit(db, member.email, "payment.delete", "invoice", p.invoice_id, json.dumps(payment_out(p), default=str))
    db.delete(p)
    db.commit()


# ---------------------------------------------------------------- invoice requests
def request_out(r: InvoiceRequest, with_items=False) -> dict:
    items = [{"particulars": i.particulars, "quantity": i.quantity, "rate": i.rate} for i in r.items]
    out = {c.name: getattr(r, c.name) for c in InvoiceRequest.__table__.columns}
    out["estimated_total"] = sum((rules.money(i["quantity"] * i["rate"]) for i in items), Decimal("0"))
    if with_items:
        out["items"] = items
    return out


def load_request(db: Session, request_id: int, member: Member) -> InvoiceRequest:
    r = db.get(InvoiceRequest, request_id)
    if not r or not (member.can("requests.review") or r.requested_by_email == member.email):
        raise HTTPException(404, "Request not found.")
    return r


@router.get("/requests")
def list_requests(status: Optional[Literal["pending", "approved", "rejected"]] = None,
                  member: Member = Depends(require("requests.create", "requests.review", any_of=True)),
                  db: Session = Depends(get_db)):
    stmt = select(InvoiceRequest).options(selectinload(InvoiceRequest.items)).order_by(InvoiceRequest.id.desc())
    if not member.can("requests.review"):
        stmt = stmt.where(InvoiceRequest.requested_by_email == member.email)
    if status:
        stmt = stmt.where(InvoiceRequest.status == status)
    return [request_out(r) for r in db.scalars(stmt.limit(500))]


@router.post("/requests", status_code=201)
def create_request(body: RequestIn, member: Member = Depends(require("requests.create")), db: Session = Depends(get_db)):
    get_branch(db, body.branch_key)
    r = InvoiceRequest(**body.model_dump(exclude={"items"}), requested_by_email=member.email, requested_by_name=member.name)
    r.items = [InvoiceRequestItem(particulars=i.particulars.strip(), quantity=i.quantity, rate=i.rate) for i in body.items]
    db.add(r)
    db.flush()
    audit(db, member.email, "request.create", "request", r.id, r.billing_name)
    db.commit()
    return {"id": r.id}


@router.get("/requests/{request_id}")
def get_request(request_id: int, member: Member = Depends(current_member), db: Session = Depends(get_db)):
    return request_out(load_request(db, request_id, member), with_items=True)


@router.post("/requests/{request_id}/reject")
def reject_request(request_id: int, member: Member = Depends(require("requests.review")), db: Session = Depends(get_db)):
    r = load_request(db, request_id, member)
    if r.status != "pending":
        raise HTTPException(409, "That request has already been processed.")
    r.status, r.reviewed_by_email, r.reviewed_at = "rejected", member.email, datetime.utcnow()
    audit(db, member.email, "request.reject", "request", r.id, r.billing_name)
    db.commit()
    return request_out(r)
