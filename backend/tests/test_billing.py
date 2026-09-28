"""Run: .venv/Scripts/python -m pytest -q  (from billing/backend)"""
import os
import tempfile
from datetime import date
from decimal import Decimal

_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/billing_test.db"
os.environ["RATE_LIMIT_PER_MINUTE"] = "100000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app import auth, rules  # noqa: E402
from app.db import Invoice, SessionLocal  # noqa: E402
from app.main import app  # noqa: E402

TODAY = date.today()
FY = rules.financial_year(TODAY)[0]


# ------------------------------------------------------------------ rules
def test_financial_year_and_numbers():
    assert rules.financial_year(date(2026, 4, 1)) == ("2627", "26-27")
    assert rules.financial_year(date(2027, 3, 31)) == ("2627", "26-27")
    existing = ["Inv2627/AM1-0007", "Invoice-26-27/AM1-0012", "Inv2627/AM2-0099", "Inv2526/AM1-0400"]
    assert rules.next_tax_invoice_number("AM1", date(2026, 9, 1), existing) == "Inv2627/AM1-0013"
    assert rules.next_tax_invoice_number("BRD", date(2026, 9, 1), existing) == "Inv2627/BRD-0001"
    assert rules.next_proforma_number("INV-041") == "INV-042"
    assert rules.next_proforma_number(None) == "INV-001"


def test_gst_split():
    inside = rules.compute_totals([(Decimal("2"), Decimal("1000.50"))], True, "Gujarat")
    assert (inside["sub_total"], inside["cgst_amount"], inside["sgst_amount"], inside["igst_amount"]) == (
        Decimal("2001.00"), Decimal("180.09"), Decimal("180.09"), Decimal("0.00"))
    assert inside["grand_total"] == Decimal("2361.18")
    outside = rules.compute_totals([(Decimal("1"), Decimal("1000"))], True, "Maharashtra")
    assert (outside["igst_rate"], outside["igst_amount"], outside["grand_total"]) == (Decimal("18"), Decimal("180.00"), Decimal("1180.00"))
    none = rules.compute_totals([(Decimal("1"), Decimal("1000"))], False, "Gujarat")
    assert none["grand_total"] == Decimal("1000.00")


def test_branch_resolution_matches_php():
    assert rules.resolve_branch("am1", "") == "ahmedabad_y"
    assert rules.resolve_branch("ahmedabad_a", "Inv2627/AM1-0003") == "ahmedabad_y"
    assert rules.resolve_branch("", "Inv2627/BRD-0003") == "baroda"
    assert rules.resolve_branch("ahmedabad", "INV-004") == "ahmedabad_a"


# ------------------------------------------------------------------ API
IDENTITIES = {
    "t-super": {"email": "owner@rexera.co.in", "role": "superadmin", "username": "Owner"},
    "t-acct": {"email": "acct@rexera.co.in", "role": "employee", "username": "Accountant"},
    "t-sales": {"email": "sales@rexera.co.in", "role": "sales", "username": "Sales Person"},
    "t-sales2": {"email": "sales2@rexera.co.in", "role": "sales", "username": "Other Sales"},
    "t-outsider": {"email": "hr@rexera.co.in", "role": "hr", "username": "HR"},
}


@pytest.fixture(scope="module")
def client():
    auth.fetch_main_identity = lambda token: IDENTITIES.get(token)
    with TestClient(app) as c:
        yield c


def h(token):
    return {"Authorization": f"Bearer {token}"}


INVOICE = {
    "invoice_type": "invoice", "invoice_date": TODAY.isoformat(), "branch_key": "ahmedabad_y",
    "billing_name": "Acme Startups", "billing_address": "Ahmedabad", "client_gstin": "24ABCDE1234F1Z5",
    "apply_gst": True, "client_state": "Gujarat",
    "items": [{"particulars": "Consultancy Services", "hsn": "998312", "quantity": 1, "rate": 10000}],
}


def test_auth_boundaries(client):
    assert client.get("/api/billing/me").status_code == 401
    assert client.get("/api/billing/me", headers=h("bogus")).status_code == 401
    assert client.get("/api/billing/me", headers=h("t-outsider")).status_code == 403  # main-app user, no billing role
    me = client.get("/api/billing/me", headers=h("t-super")).json()
    assert me["role"] == "admin" and "members.manage" in me["permissions"]


def test_full_workflow(client):
    admin = h("t-super")
    for email, role in (("acct@rexera.co.in", "accountant"), ("sales@rexera.co.in", "sales"), ("sales2@rexera.co.in", "sales")):
        assert client.post("/api/billing/members", headers=admin, json={"email": email, "role": role}).status_code == 201

    # Sales: proforma yes, tax invoice no; request yes.
    sales, acct = h("t-sales"), h("t-acct")
    assert client.post("/api/billing/invoices", headers=sales, json=INVOICE).status_code == 403
    pro = client.post("/api/billing/invoices", headers=sales, json={**INVOICE, "invoice_type": "proforma"})
    assert pro.status_code == 201 and pro.json()["invoice_number"].startswith("INV-")
    assert client.get(f"/api/billing/invoices/{pro.json()['id']}", headers=h("t-sales2")).status_code == 404
    req = client.post("/api/billing/requests", headers=sales, json={
        **{k: INVOICE[k] for k in ("billing_name", "billing_address", "client_gstin", "client_state", "branch_key")},
        "items": [{"particulars": "Pitch deck", "quantity": 2, "rate": 5000}]})
    assert req.status_code == 201

    # Accountant: never sees proformas, approves the request into a tax invoice.
    listed = client.get("/api/billing/invoices", headers=acct).json()
    assert all(i["invoice_type"] == "invoice" for i in listed["items"])
    assert client.get(f"/api/billing/invoices/{pro.json()['id']}", headers=acct).status_code == 404
    inv = client.post("/api/billing/invoices", headers=acct, json={**INVOICE, "request_id": req.json()["id"],
                      "items": [{"particulars": "Pitch deck", "hsn": "998312", "quantity": 2, "rate": 5000}]})
    assert inv.status_code == 201
    assert inv.json()["invoice_number"] == f"Inv{FY}/AM1-0001"
    r = client.get(f"/api/billing/requests/{req.json()['id']}", headers=sales).json()
    assert r["status"] == "approved" and r["invoice_id"] == inv.json()["id"]
    second = client.post("/api/billing/invoices", headers=acct, json=INVOICE).json()
    assert second["invoice_number"] == f"Inv{FY}/AM1-0002"

    detail = client.get(f"/api/billing/invoices/{inv.json()['id']}", headers=acct).json()
    assert (detail["sub_total"], detail["cgst_amount"], detail["grand_total"]) == (10000.0, 900.0, 11800.0)

    # Payments and dashboard.
    pay = {"amount": 5000, "paid_on": TODAY.isoformat(), "mode": "UPI"}
    assert client.post(f"/api/billing/invoices/{inv.json()['id']}/payments", headers=acct, json=pay).status_code == 201
    over = {**pay, "amount": 99999}
    assert client.post(f"/api/billing/invoices/{inv.json()['id']}/payments", headers=acct, json=over).status_code == 422
    dash = client.get("/api/billing/dashboard", headers=acct).json()
    assert dash["stats"]["outstanding"] == 11800 - 5000 + 11800
    assert dash["stats"]["received"] == 5000 and dash["stats"]["pending_count"] == 2
    assert "stats" not in client.get("/api/billing/dashboard", headers=sales).json()

    # Accountant cannot delete or edit; admin can edit rates (taxes recomputed) and delete.
    assert client.delete(f"/api/billing/invoices/{second['id']}", headers=acct).status_code == 403
    item_id = client.get(f"/api/billing/invoices/{second['id']}", headers=admin).json()["items"][0]["id"]
    edited = client.patch(f"/api/billing/invoices/{second['id']}/rates", headers=admin,
                          json={"items": [{"id": item_id, "rate": 20000}]}).json()
    assert edited["grand_total"] == 23600.0 and edited["sgst_amount"] == 1800.0
    assert client.delete(f"/api/billing/invoices/{pro.json()['id']}", headers=admin).status_code == 422  # proforma
    assert client.delete(f"/api/billing/invoices/{second['id']}", headers=admin).status_code == 204

    customers = client.get("/api/billing/customers", headers=acct).json()
    assert customers[0]["gstin"] == "24ABCDE1234F1Z5" and customers[0]["outstanding"] == 6800
    assert client.get("/api/billing/customers", headers=sales).status_code == 403

    csv_text = client.get("/api/billing/reports/gst-register", headers=acct,
                          params={"date_from": TODAY.isoformat(), "date_to": TODAY.isoformat()}).text
    assert f"Inv{FY}/AM1-0001" in csv_text
    actions = [a["action"] for a in client.get("/api/billing/audit", headers=admin).json()["items"]]
    assert {"invoice.create", "invoice.delete", "invoice.edit_rates", "payment.record", "member.add"} <= set(actions)
    assert client.get("/api/billing/audit", headers=acct).status_code == 403


def test_validation(client):
    acct = h("t-acct")
    bad = client.post("/api/billing/invoices", headers=acct, json={**INVOICE, "client_gstin": "NOTAGSTIN"})
    assert bad.status_code == 422
    assert client.post("/api/billing/invoices", headers=acct, json={**INVOICE, "items": []}).status_code == 422
    assert client.post("/api/billing/invoices", headers=acct, json={**INVOICE, "client_state": ""}).status_code == 422


def test_documents(client):
    sales, admin = h("t-sales"), h("t-super")
    up = client.post("/api/billing/documents", headers=sales, files={"file": ("rates.html", b"<script>x</script>", "text/html")})
    assert up.status_code == 201
    dl = client.get(f"/api/billing/documents/{up.json()['id']}/download", headers=sales)
    assert dl.content == b"<script>x</script>" and dl.headers["content-type"] == "application/octet-stream"
    assert client.delete(f"/api/billing/documents/{up.json()['id']}", headers=sales).status_code == 403
    assert client.delete(f"/api/billing/documents/{up.json()['id']}", headers=admin).status_code == 204


# ------------------------------------------------------------------ migration
LEGACY_SCHEMA = """
CREATE TABLE users (id INTEGER PRIMARY KEY, full_name TEXT, username TEXT, email TEXT, password TEXT,
  password_hash TEXT, role TEXT, branch TEXT, job_role TEXT);
CREATE TABLE invoices (id INTEGER PRIMARY KEY, invoice_number TEXT, invoice_type TEXT, invoice_date TEXT,
  billing_name TEXT, billing_address TEXT, billing_phone TEXT, billing_contact TEXT, client_gstin TEXT,
  client_state_code TEXT, sub_total NUMERIC, cgst_rate NUMERIC, cgst_amount NUMERIC, sgst_rate NUMERIC,
  sgst_amount NUMERIC, igst_rate NUMERIC, igst_amount NUMERIC, grand_total NUMERIC, remark TEXT,
  bank_account_name TEXT, bank_account_number TEXT, bank_ifsc_code TEXT, bank_upi_id TEXT,
  generated_by_user_id INTEGER, invoice_branch TEXT);
CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, particulars TEXT, description TEXT,
  hsn TEXT, quantity NUMERIC, mrp NUMERIC, amount NUMERIC, total NUMERIC);
CREATE TABLE invoice_requests (id INTEGER PRIMARY KEY, requested_by_user_id INTEGER, billing_name TEXT,
  billing_address TEXT, billing_phone TEXT, client_gstin TEXT, client_state_code TEXT, invoice_branch TEXT,
  remark TEXT, status TEXT, approved_by_user_id INTEGER, request_date TEXT);
CREATE TABLE invoice_request_items (id INTEGER PRIMARY KEY, request_id INTEGER, description TEXT, quantity NUMERIC, mrp NUMERIC);
CREATE TABLE quotations (id INTEGER PRIMARY KEY, client_name TEXT, client_phone TEXT, client_email TEXT,
  quotation_date TEXT, total_amount_without_gst NUMERIC, payment_terms TEXT, employee_name TEXT,
  employee_phone TEXT, employee_email TEXT, generated_by_user_id INTEGER);
CREATE TABLE quotation_services (id INTEGER PRIMARY KEY, quotation_id INTEGER, service_name TEXT, advance_amount NUMERIC, remarks TEXT);
CREATE TABLE resources (id INTEGER PRIMARY KEY, original_filename TEXT, stored_filename TEXT, file_type TEXT,
  uploaded_by_user_id INTEGER, created_at TEXT);
INSERT INTO users VALUES (1,'Mihir Patel','admin','mihir@rexera.co.in',NULL,'x','admin','ahmedabad_a','Branch Head');
INSERT INTO users VALUES (2,'Yash','yashkairavi@rexera.co.in',NULL,NULL,'x','admin','ahmedabad_y','Branch Head');
INSERT INTO users VALUES (3,'Ravi','ravi',NULL,'plain','','user','baroda','Business Development Executive');
INSERT INTO invoices VALUES (10,'Inv2627/AM1-0001','invoice','2026-05-02','Old Client','Addr','999',NULL,'',
  'Gujarat',1000,9,90,9,90,0,0,1180,'','A','N','I','U',1,'ahmedabad_a');
INSERT INTO invoices VALUES (11,'INV-001','proforma','2026-05-03','Lead','Addr',NULL,'888','','',500,0,0,0,0,0,0,500,'','','','','',3,'ahmedabad');
INSERT INTO invoices VALUES (12,'Inv2627/BRD-0001','invoice','2026-05-04','Approved Req','Addr','',NULL,'','',0,0,0,0,0,0,0,700,'','','','','',1,'baroda');
INSERT INTO invoice_items VALUES (1,10,'Consultancy Services',NULL,'998312',1,1000,1000,NULL);
INSERT INTO invoice_items VALUES (2,11,'Consultancy Services',NULL,'998312',1,500,500,NULL);
INSERT INTO invoice_items VALUES (3,12,NULL,'From request',NULL,1,700,NULL,700);
INSERT INTO invoice_requests VALUES (5,3,'Approved Req','Addr','','','','baroda','','approved',1,'2026-05-04 10:00:00');
INSERT INTO invoice_request_items VALUES (1,5,'From request',1,700);
INSERT INTO quotations VALUES (7,'Q Client',NULL,NULL,'2026-05-01',25000,'50% advance','Ravi','',NULL,3);
INSERT INTO quotation_services VALUES (1,7,'Pitch deck',25000,'');
INSERT INTO resources VALUES (1,'brochure.pdf','res_1.pdf','application/pdf',1,'2026-01-01 00:00:00');
"""


def _legacy_source(extra_sql=""):
    path = os.path.join(tempfile.mkdtemp(), "legacy.db")
    eng = create_engine(f"sqlite:///{path}")
    with eng.begin() as c:
        for stmt in (LEGACY_SCHEMA + extra_sql).split(";"):
            if stmt.strip():
                c.execute(text(stmt))
    uploads = tempfile.mkdtemp()
    with open(os.path.join(uploads, "res_1.pdf"), "wb") as f:
        f.write(b"%PDF-1.4 test")
    return f"sqlite:///{path}", uploads


def test_migration(client):
    import migrate_from_php as m
    # The API tests above wrote to the target; migration needs an empty one.
    with SessionLocal() as db:
        for t in ("payments", "invoice_items", "invoices", "invoice_request_items", "invoice_requests",
                  "quotation_services", "quotations", "documents", "billing_users"):
            db.execute(text(f"DELETE FROM {t}"))
        db.commit()

    src, uploads = _legacy_source()
    with SessionLocal() as db:
        dry = m.migrate(src, db, uploads, dry_run=True)
        assert not dry["blocking"], dry["blocking"]
        assert all(c["ok"] for c in dry["counts"].values())
    with SessionLocal() as db:
        assert db.query(Invoice).count() == 0  # dry run rolled back
        report = m.migrate(src, db, uploads, dry_run=False)
        assert not report["blocking"]
    with SessionLocal() as db:
        inv = db.get(Invoice, 10)
        assert inv.branch_key == "ahmedabad_y" and not inv.payment_tracked and inv.created_by_email == "mihir@rexera.co.in"
        assert db.get(Invoice, 11).billing_phone == "888" and db.get(Invoice, 11).branch_key == "ahmedabad_a"
        assert db.get(Invoice, 12).items[0].particulars == "From request"
        roles = dict(db.execute(text("SELECT email, role FROM billing_users")).all())
        assert roles == {"mihir@rexera.co.in": "admin", "yashkairavi@rexera.co.in": "accountant"}
    assert any("Ravi" in w or "ravi" in w for w in report["warnings"])  # no email -> needs a main-app account
    assert any("plain-text" in w for w in report["warnings"])

    # Migrated history does not count as outstanding; numbering continues the legacy series.
    dash = client.get("/api/billing/dashboard", headers=h("t-super"), params={"fy": "2627"}).json()
    assert dash["stats"]["outstanding"] == 0 and dash["stats"]["untracked_count"] == 2
    nxt = client.get("/api/billing/invoices/next-number", headers=h("t-super"),
                     params={"invoice_type": "invoice", "branch_key": "ahmedabad_y", "invoice_date": "2026-06-01"}).json()
    assert nxt["invoice_number"] == "Inv2627/AM1-0002"


def test_migration_blocks_duplicates():
    import migrate_from_php as m
    src, uploads = _legacy_source("INSERT INTO invoices (id, invoice_number, invoice_type, invoice_date, billing_name, grand_total) "
                                  "VALUES (13,'INV-001','proforma','2026-05-05','Dup',1);")
    with SessionLocal() as db:
        db.execute(text("DELETE FROM invoice_items"))
        db.execute(text("DELETE FROM invoices"))
        db.commit()
        report = m.migrate(src, db, uploads, dry_run=False)
        assert any("INV-001" in b for b in report["blocking"])
        assert db.query(Invoice).count() == 0


def test_dev_auth_flow(client):
    # Test dev auth endpoints
    login_res = client.post("/api/auth/login", json={"email": "dev@rexera.co.in", "password": "password"})
    assert login_res.status_code == 200
    assert login_res.json() == {"debug_otp": "123456"}

    verify_res = client.post("/api/auth/verify-2fa", json={"email": "dev@rexera.co.in", "otp": "123456"})
    assert verify_res.status_code == 200
    token = verify_res.json()["access_token"]
    assert token == "dev-token-dev@rexera.co.in"

    orig_fetch = auth.fetch_main_identity
    try:
        from app.auth import fetch_main_identity as real_fetch
        # Allow dev tokens through
        auth.fetch_main_identity = lambda tok: (
            {"email": tok[len("dev-token-"):].lower(), "role": "superadmin", "username": "Dev"}
            if tok.startswith("dev-token-") else IDENTITIES.get(tok)
        )
        me_res = client.get("/api/billing/me", headers={"Authorization": f"Bearer {token}"})
        assert me_res.status_code == 200
        me = me_res.json()
        assert me["email"] == "dev@rexera.co.in"
        assert me["role"] == "admin"
        assert "invoices.create_tax" in me["permissions"]
    finally:
        auth.fetch_main_identity = orig_fetch


