"""Dashboard, customers and reports. All figures are computed from invoices and payments.

ponytail: aggregates are computed in Python over the caller's visible invoices; move to SQL
GROUP BY if the invoice count grows past ~50k.
"""
from collections import defaultdict
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import rules
from app.auth import Member, current_member, require
from app.db import Branch, Invoice, InvoiceRequest, Payment, Quotation, get_db
from app.routes.invoices import csv_response, paid_of, payment_out, request_out, summary, visible

router = APIRouter(prefix="/api/billing", tags=["Dashboard & reports"])

ZERO = Decimal("0")
MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]


def fy_or_current(fy: Optional[str]) -> str:
    if fy is None:
        return rules.financial_year(date.today())[0]
    if len(fy) != 4 or not fy.isdigit() or int(fy[2:]) != (int(fy[:2]) + 1) % 100:
        raise ValueError
    return fy


def tax_invoices(db: Session, date_from: Optional[date] = None, date_to: Optional[date] = None):
    stmt = select(Invoice).where(Invoice.invoice_type == "invoice").options(selectinload(Invoice.payments))
    if date_from:
        stmt = stmt.where(Invoice.invoice_date >= date_from)
    if date_to:
        stmt = stmt.where(Invoice.invoice_date <= date_to)
    return db.scalars(stmt).all()


@router.get("/dashboard")
def dashboard(fy: Optional[str] = None, member: Member = Depends(current_member), db: Session = Depends(get_db)):
    try:
        fy = fy_or_current(fy)
    except ValueError:
        raise HTTPException(422, "Financial year must look like 2627.")
    start, end = rules.fy_bounds(fy)
    out: dict = {"fy": fy, "fy_label": f"FY 20{fy[:2]}-{fy[2:]}"}

    recent = db.scalars(select(Invoice).where(visible(member)).options(selectinload(Invoice.payments))
                        .order_by(Invoice.id.desc()).limit(8)).all()
    out["recent_invoices"] = [summary(i) for i in recent]

    if member.can("invoices.view"):
        all_tax = tax_invoices(db)
        in_fy = [i for i in all_tax if start <= i.invoice_date <= end]
        tracked = [i for i in all_tax if i.payment_tracked]
        open_ = sorted((i for i in tracked if paid_of(i) < i.grand_total), key=lambda i: (i.invoice_date, i.id))
        out["stats"] = {
            "billed": sum((i.grand_total for i in in_fy), ZERO),
            "invoice_count": len(in_fy),
            "outstanding": sum((i.grand_total - paid_of(i) for i in open_), ZERO),
            "pending_count": len(open_),
            "paid_count": sum(1 for i in in_fy if rules.payment_status(i) == "paid"),
            "untracked_count": sum(1 for i in all_tax if not i.payment_tracked),
        }
        out["pending_payments"] = [{**summary(i), "age_days": (date.today() - i.invoice_date).days} for i in open_[:8]]

    if member.can("payments.view"):
        if "stats" in out:
            out["stats"]["received"] = sum(db.scalars(select(Payment.amount).where(
                Payment.paid_on >= start, Payment.paid_on <= end)), ZERO)
        rows = db.execute(select(Payment, Invoice).join(Invoice, Invoice.id == Payment.invoice_id)
                          .order_by(Payment.paid_on.desc(), Payment.id.desc()).limit(8)).all()
        out["recent_payments"] = [payment_out(p, i) for p, i in rows]

    if member.can("requests.review") or member.can("requests.create"):
        stmt = select(InvoiceRequest).options(selectinload(InvoiceRequest.items)).order_by(InvoiceRequest.id.desc())
        if member.can("requests.review"):
            stmt = stmt.where(InvoiceRequest.status == "pending")
        else:
            stmt = stmt.where(InvoiceRequest.requested_by_email == member.email)
        reqs = db.scalars(stmt).all()
        out["requests"] = [request_out(r) for r in reqs[:8]]
        out["pending_request_count"] = sum(1 for r in reqs if r.status == "pending")

    if member.can("quotations.create") and not member.can("quotations.view"):
        qs = db.scalars(select(Quotation).where(Quotation.created_by_email == member.email)
                        .order_by(Quotation.id.desc()).limit(5)).all()
        out["my_quotations"] = [{"id": q.id, "client_name": q.client_name, "quotation_date": q.quotation_date,
                                 "total_amount": q.total_amount} for q in qs]
    return out


@router.get("/customers")
def customers(q: str = "", member: Member = Depends(require("customers.view")), db: Session = Depends(get_db)):
    """Billed parties. The PHP app kept client details on each invoice rather than in a customer
    table, so a customer is every tax invoice sharing a GSTIN (or, without one, a name)."""
    groups: dict = {}
    for inv in sorted(tax_invoices(db), key=lambda i: (i.invoice_date, i.id)):
        key = inv.client_gstin or " ".join(inv.billing_name.lower().split())
        g = groups.setdefault(key, {"key": key, "invoices": 0, "billed": ZERO, "paid": ZERO, "outstanding": ZERO})
        paid = paid_of(inv)
        g.update(name=inv.billing_name, gstin=inv.client_gstin, phone=inv.billing_phone or g.get("phone", ""),
                 state=inv.client_state or g.get("state", ""), address=inv.billing_address,
                 last_invoice_date=inv.invoice_date)
        g["invoices"] += 1
        g["billed"] += inv.grand_total
        g["paid"] += paid
        if inv.payment_tracked:
            g["outstanding"] += inv.grand_total - paid
    rows = list(groups.values())
    if q.strip():
        needle = q.strip().lower()
        rows = [r for r in rows if needle in r["name"].lower() or needle in r["gstin"].lower() or needle in r["phone"]]
    return sorted(rows, key=lambda r: r["billed"], reverse=True)


@router.get("/reports/summary")
def report_summary(fy: Optional[str] = None, member: Member = Depends(require("reports.view")),
                   db: Session = Depends(get_db)):
    try:
        fy = fy_or_current(fy)
    except ValueError:
        raise HTTPException(422, "Financial year must look like 2627.")
    start, end = rules.fy_bounds(fy)
    months = {m: {"month": m, "count": 0, "taxable": ZERO, "cgst": ZERO, "sgst": ZERO, "igst": ZERO,
                  "total": ZERO, "received": ZERO} for m in MONTHS}
    branches = {b.key: {"branch_key": b.key, "branch": b.display_name, "count": 0, "total": ZERO}
                for b in db.scalars(select(Branch))}
    month_of = lambda d: MONTHS[(d.month - 4) % 12]  # noqa: E731
    for inv in tax_invoices(db, start, end):
        m = months[month_of(inv.invoice_date)]
        m["count"] += 1
        m["taxable"] += inv.sub_total
        m["cgst"] += inv.cgst_amount
        m["sgst"] += inv.sgst_amount
        m["igst"] += inv.igst_amount
        m["total"] += inv.grand_total
        b = branches.setdefault(inv.branch_key, {"branch_key": inv.branch_key, "branch": inv.branch_key, "count": 0, "total": ZERO})
        b["count"] += 1
        b["total"] += inv.grand_total
    for p in db.scalars(select(Payment).where(Payment.paid_on >= start, Payment.paid_on <= end)):
        months[month_of(p.paid_on)]["received"] += p.amount
    rows = list(months.values())
    totals = {k: sum((r[k] for r in rows), ZERO) for k in ("taxable", "cgst", "sgst", "igst", "total", "received")}
    totals["count"] = sum(r["count"] for r in rows)
    return {"fy": fy, "fy_label": f"FY 20{fy[:2]}-{fy[2:]}", "months": rows, "totals": totals,
            "branches": list(branches.values())}


@router.get("/reports/gst-register")
def gst_register(date_from: date, date_to: date, member: Member = Depends(require("reports.view")),
                 db: Session = Depends(get_db)):
    """Tax invoice register for GST filing, as CSV."""
    rows = [["Invoice Number", "Date", "Branch", "Customer", "GSTIN", "State", "Taxable", "CGST", "SGST", "IGST",
             "Grand Total", "Paid", "Status"]]
    for i in sorted(tax_invoices(db, date_from, date_to), key=lambda i: (i.invoice_date, i.id)):
        rows.append([i.invoice_number, i.invoice_date.isoformat(), i.branch_key, i.billing_name, i.client_gstin,
                     i.client_state, i.sub_total, i.cgst_amount, i.sgst_amount, i.igst_amount, i.grand_total,
                     paid_of(i), rules.payment_status(i)])
    return csv_response(rows, f"gst_register_{date_from}_{date_to}.csv")
