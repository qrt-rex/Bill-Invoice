"""Copy the legacy bill.rexera.in MySQL data into the billing database, then verify it.

Read-only on the source. Run it against a RESTORED COPY of the production dump first:

    python migrate_from_php.py --source "mysql+pymysql://user:pass@127.0.0.1:3306/u417368936_bill" \
        --uploads-dir ./legacy_uploads --dry-run

--dry-run does the whole copy and verification inside a transaction and rolls it back.
Without it the data is committed. The target must be empty (a fresh billing database).
A JSON report (counts, totals, anything that needs a human) is written next to the script.

Old -> new mapping is documented in docs/MIGRATION.md.
"""
import argparse
import json
import os
import sys
from collections import Counter
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.orm import Session

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import rules  # noqa: E402
from app.db import (BillingUser, Document, Invoice, InvoiceItem, InvoiceRequest, InvoiceRequestItem,  # noqa: E402
                    Quotation, QuotationService, SessionLocal, init_db)

ADMIN_ROLES = {"admin", "super admin", "admin member", "manager"}  # login.php
ACCOUNTANT_USERNAMES = {"yashkairavi@rexera.co.in"}                # hard-coded restriction in admin.php
BRANCH_KEYS = {"ahmedabad_y", "ahmedabad_a", "baroda"}


class MigrationError(Exception):
    pass


def s(v) -> str:
    return "" if v is None else str(v).strip()


def dec(v) -> Decimal:
    try:
        return rules.money(v if v not in (None, "") else 0)
    except InvalidOperation:
        raise MigrationError(f"Not a number: {v!r}")


def to_date(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(s(v)[:10])
    except ValueError:
        return None


def to_dt(v):
    if isinstance(v, datetime):
        return v
    d = to_date(v)
    return datetime(d.year, d.month, d.day) if d else None


def rows(src, table: str, tables: set):
    if table not in tables:
        return []
    return [dict(r._mapping) for r in src.execute(text(f"SELECT * FROM {table} ORDER BY id"))]


def migrate(source_url: str, db: Session, uploads_dir: str = "", dry_run: bool = True) -> dict:
    report: dict = {"source": source_url.split("@")[-1], "dry_run": dry_run, "counts": {}, "warnings": [], "blocking": []}
    warn, block = report["warnings"].append, report["blocking"].append

    if db.scalar(select(func.count(Invoice.id))):
        raise MigrationError("The target billing database already has invoices. Use a fresh database.")

    engine = create_engine(source_url)
    with engine.connect() as src:
        tables = set(inspect(src).get_table_names())
        data = {t: rows(src, t, tables) for t in ("users", "invoices", "invoice_items", "invoice_requests",
                                                  "invoice_request_items", "quotations", "quotation_services",
                                                  "resources", "invoice_a")}
    report["source_tables"] = sorted(tables)

    # ---- users -> billing_users (accounts themselves live in the main application)
    users = {}
    for u in data["users"]:
        email = (s(u.get("email")) or (s(u.get("username")) if "@" in s(u.get("username")) else "")).lower()
        users[u["id"]] = {"email": email, "name": s(u.get("full_name")) or s(u.get("username")) or email}
        role = s(u.get("role")).lower()
        billing_role = ("accountant" if s(u.get("username")).lower() in ACCOUNTANT_USERNAMES
                        else "admin" if role in ADMIN_ROLES else "sales")
        if not email:
            warn(f"User #{u['id']} '{s(u.get('username'))}' has no email: create a main-app account for them, "
                 f"then grant billing access as '{billing_role}'.")
            continue
        if any(bu.email == email for bu in db.new if isinstance(bu, BillingUser)):
            warn(f"User #{u['id']} shares the email {email} with an earlier user; only the first gets billing access.")
            continue
        branch = s(u.get("branch")).lower()
        db.add(BillingUser(email=email, full_name=users[u["id"]]["name"], job_role=s(u.get("job_role")),
                           role=billing_role, branch_key=branch if branch in BRANCH_KEYS else None,
                           legacy_user_id=u["id"]))
    if any(s(u.get("password")) for u in data["users"]):
        warn("Legacy users table stores some plain-text passwords. Destroy the old database once cutover is verified.")

    def who(uid):
        return users.get(uid, {"email": "", "name": ""})

    # ---- invoices
    numbers = Counter(s(i.get("invoice_number")) for i in data["invoices"])
    for n, c in numbers.items():
        if not n:
            block(f"{c} invoice(s) have an empty invoice number.")
        elif c > 1:
            block(f"Invoice number {n!r} is used {c} times; resolve duplicates in the source first.")
    items_by_invoice: dict = {}
    for it in data["invoice_items"]:
        items_by_invoice.setdefault(it.get("invoice_id"), []).append(it)
    invoice_ids = {i["id"] for i in data["invoices"]}

    for i in data["invoices"]:
        itype = s(i.get("invoice_type")).lower()
        if itype not in ("invoice", "proforma"):
            block(f"Invoice #{i['id']} has unknown type {itype!r}.")
            continue
        d = to_date(i.get("invoice_date"))
        if not d:
            block(f"Invoice #{i['id']} has an invalid date {i.get('invoice_date')!r}.")
            continue
        creator = who(i.get("generated_by_user_id"))
        inv = Invoice(
            id=i["id"], invoice_number=s(i.get("invoice_number")), invoice_type=itype, invoice_date=d,
            branch_key=rules.resolve_branch(s(i.get("invoice_branch")), s(i.get("invoice_number"))),
            billing_name=s(i.get("billing_name")), billing_address=s(i.get("billing_address")),
            billing_phone=s(i.get("billing_phone")) or s(i.get("billing_contact")),
            client_gstin=s(i.get("client_gstin")).upper(), client_state=s(i.get("client_state_code")),
            sub_total=dec(i.get("sub_total")), cgst_rate=dec(i.get("cgst_rate")), cgst_amount=dec(i.get("cgst_amount")),
            sgst_rate=dec(i.get("sgst_rate")), sgst_amount=dec(i.get("sgst_amount")), igst_rate=dec(i.get("igst_rate")),
            igst_amount=dec(i.get("igst_amount")), grand_total=dec(i.get("grand_total")), remark=s(i.get("remark")),
            bank_account_name=s(i.get("bank_account_name")), bank_account_number=s(i.get("bank_account_number")),
            bank_ifsc_code=s(i.get("bank_ifsc_code")), bank_upi_id=s(i.get("bank_upi_id")),
            created_by_email=creator["email"], created_by_name=creator["name"],
            payment_tracked=False, created_at=to_dt(i.get("created_at")) or to_dt(d),
        )
        for pos, it in enumerate(items_by_invoice.get(i["id"], [])):
            qty, rate = dec(it.get("quantity")), dec(it.get("mrp"))
            amount = it.get("amount") if it.get("amount") is not None else it.get("total")
            inv.items.append(InvoiceItem(position=pos, particulars=s(it.get("particulars")) or s(it.get("description")) or "-",
                                         hsn=s(it.get("hsn")), quantity=qty, rate=rate,
                                         amount=dec(amount) if amount is not None else rules.money(qty * rate)))
        if not inv.items:
            warn(f"Invoice {inv.invoice_number} (#{inv.id}) has no line items.")
        elif abs(sum(x.amount for x in inv.items) - inv.sub_total) > Decimal("0.05"):
            warn(f"Invoice {inv.invoice_number} (#{inv.id}): items add up to {sum(x.amount for x in inv.items)} "
                 f"but sub-total is {inv.sub_total} (kept as stored).")
        db.add(inv)

    orphans = [it["id"] for it in data["invoice_items"] if it.get("invoice_id") not in invoice_ids]
    if orphans:
        warn(f"{len(orphans)} invoice_items rows point at no invoice (likely the legacy invoice_a table); not migrated: {orphans[:50]}")
    if data["invoice_a"]:
        warn(f"Legacy table invoice_a has {len(data['invoice_a'])} rows (written by the unused g_invoice.php). "
             "They are not migrated automatically; review them.")

    # ---- invoice requests
    req_items: dict = {}
    for it in data["invoice_request_items"]:
        req_items.setdefault(it.get("request_id"), []).append(it)
    for r in data["invoice_requests"]:
        requester, reviewer = who(r.get("requested_by_user_id")), who(r.get("approved_by_user_id"))
        status = s(r.get("status")).lower() or "pending"
        req = InvoiceRequest(
            id=r["id"], requested_by_email=requester["email"], requested_by_name=requester["name"],
            billing_name=s(r.get("billing_name")), billing_address=s(r.get("billing_address")),
            billing_phone=s(r.get("billing_phone")), client_gstin=s(r.get("client_gstin")).upper(),
            client_state=s(r.get("client_state_code")),
            branch_key=rules.resolve_branch(s(r.get("invoice_branch")), ""), remark=s(r.get("remark")),
            status=status if status in ("pending", "approved", "rejected") else "pending",
            reviewed_by_email=reviewer["email"],
            created_at=to_dt(r.get("request_date")) or to_dt(r.get("created_at")) or datetime.utcnow(),
        )
        req.items = [InvoiceRequestItem(particulars=s(it.get("description")) or "-", quantity=dec(it.get("quantity")),
                                        rate=dec(it.get("mrp"))) for it in req_items.get(r["id"], [])]
        db.add(req)

    # ---- quotations
    q_services: dict = {}
    for sv in data["quotation_services"]:
        q_services.setdefault(sv.get("quotation_id"), []).append(sv)
    for q in data["quotations"]:
        creator = who(q.get("generated_by_user_id"))
        quote = Quotation(
            id=q["id"], client_name=s(q.get("client_name")), client_phone=s(q.get("client_phone")),
            client_email=s(q.get("client_email")), quotation_date=to_date(q.get("quotation_date")) or date(1970, 1, 1),
            total_amount=dec(q.get("total_amount_without_gst")), payment_terms=s(q.get("payment_terms")),
            employee_name=s(q.get("employee_name")), employee_phone=s(q.get("employee_phone")),
            employee_email=s(q.get("employee_email")), created_by_email=creator["email"],
            created_at=to_dt(q.get("created_at")) or to_dt(q.get("quotation_date")) or datetime.utcnow(),
        )
        quote.services = [QuotationService(service_name=s(sv.get("service_name")) or "-", amount=dec(sv.get("advance_amount")),
                                           remarks=s(sv.get("remarks"))) for sv in q_services.get(q["id"], [])]
        db.add(quote)

    # ---- resources -> documents (file bytes read from the old uploads/ folder)
    missing = []
    for r in data["resources"]:
        path = os.path.join(uploads_dir, os.path.basename(s(r.get("stored_filename"))))
        if not uploads_dir or not os.path.isfile(path):
            missing.append(s(r.get("original_filename")) or s(r.get("stored_filename")))
            continue
        with open(path, "rb") as f:
            blob = f.read()
        db.add(Document(id=r["id"], original_filename=s(r.get("original_filename")) or os.path.basename(path),
                        content_type=s(r.get("file_type")) or "application/octet-stream", size=len(blob), data=blob,
                        uploaded_by_email=who(r.get("uploaded_by_user_id"))["email"],
                        created_at=to_dt(r.get("created_at")) or datetime.utcnow()))
    if missing:
        warn(f"{len(missing)} resource file(s) not found in --uploads-dir, not migrated: {missing[:50]}")

    if report["blocking"]:
        db.rollback()
        return report

    db.flush()
    if db.bind.dialect.name == "postgresql":  # explicit ids were inserted; move the id sequences past them
        for table in ("invoices", "invoice_requests", "quotations", "documents"):
            db.execute(text(f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), COALESCE((SELECT MAX(id) FROM {table}), 1))"))

    # ---- verification
    def src_total(rows_, key):
        return sum((dec(r.get(key)) for r in rows_), Decimal("0"))

    migrated = [i for i in data["invoices"] if s(i.get("invoice_type")).lower() in ("invoice", "proforma")]
    checks = {
        "invoices": (len(data["invoices"]), db.scalar(select(func.count(Invoice.id)))),
        "tax_invoices": (sum(1 for i in migrated if s(i["invoice_type"]).lower() == "invoice"),
                         db.scalar(select(func.count(Invoice.id)).where(Invoice.invoice_type == "invoice"))),
        "invoice_items": (len(data["invoice_items"]) - len(orphans), db.scalar(select(func.count(InvoiceItem.id)))),
        "grand_total_sum": (src_total(data["invoices"], "grand_total"),
                            db.scalar(select(func.coalesce(func.sum(Invoice.grand_total), 0)))),
        "invoice_requests": (len(data["invoice_requests"]), db.scalar(select(func.count(InvoiceRequest.id)))),
        "invoice_request_items": (len(data["invoice_request_items"]), db.scalar(select(func.count(InvoiceRequestItem.id)))),
        "quotations": (len(data["quotations"]), db.scalar(select(func.count(Quotation.id)))),
        "quotation_services": (len(data["quotation_services"]), db.scalar(select(func.count(QuotationService.id)))),
        "documents": (len(data["resources"]) - len(missing), db.scalar(select(func.count(Document.id)))),
        "billing_users": (len({u["email"] for u in users.values() if u["email"]}),db.scalar(select(func.count(BillingUser.id)))),
    }
    for name, (want, got) in checks.items():
        ok = Decimal(str(want)) == Decimal(str(got))
        report["counts"][name] = {"source": str(want), "target": str(got), "ok": ok}
        if not ok:
            block(f"Verification failed for {name}: source {want}, target {got}.")

    if dry_run or report["blocking"]:
        db.rollback()
    else:
        db.commit()
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", required=True, help="SQLAlchemy URL of the legacy MySQL database (a restored copy)")
    ap.add_argument("--uploads-dir", default="", help="Copy of the old public_html/uploads folder")
    ap.add_argument("--dry-run", action="store_true", help="Verify everything, then roll back")
    args = ap.parse_args()

    init_db()
    with SessionLocal() as db:
        try:
            report = migrate(args.source, db, args.uploads_dir, args.dry_run)
        except MigrationError as e:
            print(f"Migration stopped: {e}")
            sys.exit(2)
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       f"migration_report_{datetime.now():%Y%m%d_%H%M%S}.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, default=str)
    for name, c in report["counts"].items():
        print(f"{'OK ' if c['ok'] else 'BAD'} {name:<22} source={c['source']:<14} target={c['target']}")
    for w in report["warnings"]:
        print(f"WARNING  {w}")
    for b in report["blocking"]:
        print(f"BLOCKING {b}")
    status = "rolled back (dry run)" if args.dry_run else ("NOT committed" if report["blocking"] else "committed")
    print(f"\nResult: {status}. Report: {out}")
    sys.exit(1 if report["blocking"] else 0)


if __name__ == "__main__":
    main()
