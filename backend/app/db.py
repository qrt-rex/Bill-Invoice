"""Billing database: engine, session and schema.

Tables mirror what the legacy PHP app (bill.rexera.in) actually stores, see
docs/MIGRATION.md for the old-table -> new-table mapping. Money is NUMERIC(14,2).
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (Boolean, Date, DateTime, ForeignKey, Integer, LargeBinary, Numeric, String, Text,
                        create_engine, select)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, deferred, mapped_column, relationship, sessionmaker

from app.config import settings

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True,
                       connect_args={"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {})
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

Money = Numeric(14, 2)


class Base(DeclarativeBase):
    pass


def now() -> datetime:
    return datetime.utcnow()


class Branch(Base):
    __tablename__ = "branches"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    prefix: Mapped[str] = mapped_column(String(10), unique=True)
    display_name: Mapped[str] = mapped_column(String(80))
    legal_name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str] = mapped_column(Text)
    phone: Mapped[str] = mapped_column(String(40))


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class BillingUser(Base):
    """Billing access for an account of the main application, matched by email."""
    __tablename__ = "billing_users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200), default="")
    job_role: Mapped[str] = mapped_column(String(100), default="")
    role: Mapped[str] = mapped_column(String(20))
    branch_key: Mapped[Optional[str]] = mapped_column(ForeignKey("branches.key"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    legacy_user_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_number: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    invoice_type: Mapped[str] = mapped_column(String(10), index=True)  # 'invoice' (tax) | 'proforma'
    invoice_date: Mapped[date] = mapped_column(Date, index=True)
    branch_key: Mapped[str] = mapped_column(ForeignKey("branches.key"))
    billing_name: Mapped[str] = mapped_column(String(255))
    billing_address: Mapped[str] = mapped_column(Text, default="")
    billing_phone: Mapped[str] = mapped_column(String(60), default="")
    client_gstin: Mapped[str] = mapped_column(String(20), default="")
    client_state: Mapped[str] = mapped_column(String(80), default="")
    sub_total: Mapped[Decimal] = mapped_column(Money, default=0)
    cgst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    cgst_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    sgst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    sgst_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    igst_rate: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    igst_amount: Mapped[Decimal] = mapped_column(Money, default=0)
    grand_total: Mapped[Decimal] = mapped_column(Money, default=0)
    remark: Mapped[str] = mapped_column(Text, default="")
    bank_account_name: Mapped[str] = mapped_column(String(200), default="")
    bank_account_number: Mapped[str] = mapped_column(String(60), default="")
    bank_ifsc_code: Mapped[str] = mapped_column(String(30), default="")
    bank_upi_id: Mapped[str] = mapped_column(String(100), default="")
    created_by_email: Mapped[str] = mapped_column(String(200), default="", index=True)
    created_by_name: Mapped[str] = mapped_column(String(200), default="")
    request_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Invoices migrated from the PHP app carry no payment history, so they are excluded from
    # outstanding figures until someone records a payment against them.
    payment_tracked: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    items: Mapped[list["InvoiceItem"]] = relationship(order_by="InvoiceItem.position", cascade="all, delete-orphan")
    payments: Mapped[list["Payment"]] = relationship(order_by="Payment.paid_on", cascade="all, delete-orphan")


class InvoiceItem(Base):
    __tablename__ = "invoice_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    particulars: Mapped[str] = mapped_column(Text)
    hsn: Mapped[str] = mapped_column(String(20), default="")
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    rate: Mapped[Decimal] = mapped_column(Money)
    amount: Mapped[Decimal] = mapped_column(Money)


class Payment(Base):
    __tablename__ = "payments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(Money)
    paid_on: Mapped[date] = mapped_column(Date, index=True)
    mode: Mapped[str] = mapped_column(String(30))
    reference: Mapped[str] = mapped_column(String(120), default="")
    note: Mapped[str] = mapped_column(Text, default="")
    recorded_by_email: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class InvoiceRequest(Base):
    __tablename__ = "invoice_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    requested_by_email: Mapped[str] = mapped_column(String(200), index=True)
    requested_by_name: Mapped[str] = mapped_column(String(200), default="")
    billing_name: Mapped[str] = mapped_column(String(255))
    billing_address: Mapped[str] = mapped_column(Text, default="")
    billing_phone: Mapped[str] = mapped_column(String(60), default="")
    client_gstin: Mapped[str] = mapped_column(String(20), default="")
    client_state: Mapped[str] = mapped_column(String(80), default="")
    branch_key: Mapped[str] = mapped_column(ForeignKey("branches.key"))
    remark: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(10), default="pending", index=True)  # pending|approved|rejected
    reviewed_by_email: Mapped[str] = mapped_column(String(200), default="")
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    invoice_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    items: Mapped[list["InvoiceRequestItem"]] = relationship(cascade="all, delete-orphan")


class InvoiceRequestItem(Base):
    __tablename__ = "invoice_request_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("invoice_requests.id", ondelete="CASCADE"), index=True)
    particulars: Mapped[str] = mapped_column(Text)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    rate: Mapped[Decimal] = mapped_column(Money)


class Quotation(Base):
    __tablename__ = "quotations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_name: Mapped[str] = mapped_column(String(255))
    client_phone: Mapped[str] = mapped_column(String(60), default="")
    client_email: Mapped[str] = mapped_column(String(200), default="")
    quotation_date: Mapped[date] = mapped_column(Date)
    total_amount: Mapped[Decimal] = mapped_column(Money)  # professional fees, GST not included
    payment_terms: Mapped[str] = mapped_column(Text, default="")
    employee_name: Mapped[str] = mapped_column(String(200), default="")
    employee_phone: Mapped[str] = mapped_column(String(60), default="")
    employee_email: Mapped[str] = mapped_column(String(200), default="")
    created_by_email: Mapped[str] = mapped_column(String(200), default="", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    services: Mapped[list["QuotationService"]] = relationship(cascade="all, delete-orphan")


class QuotationService(Base):
    __tablename__ = "quotation_services"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    quotation_id: Mapped[int] = mapped_column(ForeignKey("quotations.id", ondelete="CASCADE"), index=True)
    service_name: Mapped[str] = mapped_column(String(255))
    amount: Mapped[Decimal] = mapped_column(Money)
    remarks: Mapped[str] = mapped_column(Text, default="")


class Document(Base):
    """Shared resources (the PHP 'resources' page). File bytes live in the database so they
    survive redeploys and are covered by database backups."""
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(120), default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer, default=0)
    data: Mapped[bytes] = deferred(mapped_column(LargeBinary))
    uploaded_by_email: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
    actor_email: Mapped[str] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(60))
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(60), default="")
    detail: Mapped[str] = mapped_column(Text, default="")


# The three branches from the PHP app's config.php.
BRANCHES = [
    {"key": "ahmedabad_y", "prefix": "AM1", "display_name": "Ahmedabad(Y)",
     "address": "102-b Block D Ganesh, Meridian Opp Kargil Pump, Ghatlodia, Ahmedabad, Gujarat, 380061"},
    {"key": "ahmedabad_a", "prefix": "AM2", "display_name": "Ahmedabad(A)",
     "address": "1408-1409, 14th Floor, Altimus, Navrangpura, Ahmedabad, Gujarat 380009"},
    {"key": "baroda", "prefix": "BRD", "display_name": "Baroda",
     "address": "610, 6th Floor, Everest Onyx, Beside Indraprasth Appartment, Race course road, Vadiwadi, Baroda - 390021"},
]

# Defaults hard-coded in the PHP invoice and quotation forms; editable in Settings.
DEFAULT_SETTINGS = {
    "company_name": "REXERA FINANCIAL SERVICES PRIVATE LIMITED",
    "company_gstin": "24AAOCR9991A1ZZ",
    "company_email": "info@rexera.co.in",
    "company_website": "www.rexera.co.in",
    "bank_account_name": "REXERA FINANCIAL SERVICES PVT LTD",
    "bank_account_number": "404005000998",
    "bank_ifsc_code": "ICIC0004040",
    "bank_name": "ICICI Bank",
    "bank_upi_id": "rexer26340.ibz@icici",
    "default_particulars": "Consultancy Services",
    "default_hsn": "998312",
}


def init_db() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        for b in BRANCHES:
            if not db.get(Branch, b["key"]):
                db.add(Branch(legal_name=DEFAULT_SETTINGS["company_name"], phone="9898187478", **b))
        existing = set(db.scalars(select(Setting.key)))
        db.add_all(Setting(key=k, value=v) for k, v in DEFAULT_SETTINGS.items() if k not in existing)
        db.commit()


def get_db():
    with SessionLocal() as db:
        yield db


def settings_map(db: Session) -> dict:
    return {s.key: s.value for s in db.scalars(select(Setting))}


def audit(db: Session, actor: str, action: str, entity: str, entity_id="", detail: str = "") -> None:
    db.add(AuditLog(actor_email=actor, action=action, entity=entity, entity_id=str(entity_id), detail=detail))
