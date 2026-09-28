"""Billing rules ported from the PHP app, kept free of I/O so they are easy to test."""
import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable, Optional, Tuple

HOME_STATE = "Gujarat"          # invoice.php: CGST+SGST inside Gujarat, IGST elsewhere
CGST_RATE = SGST_RATE = Decimal("9")
IGST_RATE = Decimal("18")

INDIAN_STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
    "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
    "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
    "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
]

GSTIN_RE = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$")  # ajax_fetch_gst_from_crm.php

CENT = Decimal("0.01")


def money(v) -> Decimal:
    return Decimal(str(v)).quantize(CENT, rounding=ROUND_HALF_UP)


def financial_year(d: date) -> Tuple[str, str]:
    """('2627', '26-27') for any date from 1 Apr 2026 to 31 Mar 2027."""
    start = d.year if d.month >= 4 else d.year - 1
    a, b = str(start)[2:], str(start + 1)[2:]
    return a + b, f"{a}-{b}"


def fy_bounds(fy: str) -> Tuple[date, date]:
    start = 2000 + int(fy[:2])
    return date(start, 4, 1), date(start + 1, 3, 31)


def tax_invoice_patterns(prefix: str, d: date) -> Tuple[str, str]:
    """SQL LIKE patterns for this branch's series in the invoice date's financial year:
    the current format 'Inv2627/AM1-0001' and the older 'Invoice-26-27/AM1-0001'."""
    fy_new, fy_old = financial_year(d)
    return f"Inv{fy_new}/{prefix}-%", f"Invoice-{fy_old}/{prefix}-%"


def next_tax_invoice_number(prefix: str, d: date, existing: Iterable[str]) -> str:
    """ajax_get_invoice_number.php: highest sequence in either format + 1, format 'Inv2627/AM1-0001'."""
    fy_new, fy_old = financial_year(d)
    pattern = re.compile(rf"^(?:Inv{fy_new}|Invoice-{fy_old})/{re.escape(prefix)}-(\d+)$")
    seqs = [int(m.group(1)) for n in existing if (m := pattern.match(n.strip()))]
    return f"Inv{fy_new}/{prefix}-{max(seqs, default=0) + 1:04d}"


def next_proforma_number(last_number: Optional[str]) -> str:
    """invoice.php: trailing digits of the latest proforma + 1, format 'INV-001'."""
    m = re.search(r"(\d+)$", last_number or "")
    return f"INV-{(int(m.group(1)) + 1) if m else 1:03d}"


def compute_totals(items: Iterable[Tuple[Decimal, Decimal]], apply_gst: bool, client_state: str) -> dict:
    """items are (quantity, rate). Mirrors updateCalculations() in invoice.php, but on the server."""
    amounts = [money(Decimal(q) * Decimal(r)) for q, r in items]
    sub = sum(amounts, Decimal("0.00"))
    cgst = sgst = igst = Decimal("0")
    if apply_gst and client_state:
        if client_state == HOME_STATE:
            cgst, sgst = CGST_RATE, SGST_RATE
        else:
            igst = IGST_RATE
    tax = {k: money(sub * r / 100) for k, r in (("cgst", cgst), ("sgst", sgst), ("igst", igst))}
    return {
        "amounts": amounts,
        "sub_total": sub,
        "cgst_rate": cgst, "cgst_amount": tax["cgst"],
        "sgst_rate": sgst, "sgst_amount": tax["sgst"],
        "igst_rate": igst, "igst_amount": tax["igst"],
        "grand_total": sub + tax["cgst"] + tax["sgst"] + tax["igst"],
    }


def resolve_branch(raw_branch: str, invoice_number: str) -> str:
    """generate_invoice.php / view_invoice.php: legacy rows store the branch inconsistently,
    and the invoice number's series is the tie-breaker."""
    b = (raw_branch or "").strip().lower()
    n = invoice_number or ""
    in_series = lambda p: f"/{p}-" in n or f"-{p}-" in n  # noqa: E731
    if b in ("ahmedabad_y", "am1") or "ahmedabad(y)" in b:
        return "ahmedabad_y"
    if b in ("ahmedabad_a", "am2") or "ahmedabad(a)" in b:
        return "ahmedabad_y" if in_series("AM1") else "ahmedabad_a"
    if b in ("baroda", "brd"):
        return "baroda"
    if in_series("AM1"):
        return "ahmedabad_y"
    if in_series("BRD"):
        return "baroda"
    return "ahmedabad_a"


def payment_status(inv) -> str:
    if inv.invoice_type != "invoice":
        return "proforma"
    if not inv.payment_tracked:
        return "not_tracked"
    paid = sum((p.amount for p in inv.payments), Decimal("0"))
    if paid <= 0:
        return "unpaid"
    return "paid" if paid >= inv.grand_total else "partial"
