#!/usr/bin/env python3
"""
Generate the UPI payment QR for the site.

    pip install qrcode pillow
    python3 tools/make-upi-qr.py 7990853947@ybl

Writes assets/we3-upi-qr.png, then set that path in CONFIG.upi.qrImage.

Uses the `qrcode` library rather than a hand-rolled encoder: a QR that is
even slightly wrong sends money nowhere, or worse, somewhere else.
"""
import sys
from pathlib import Path
from urllib.parse import quote

import qrcode
from qrcode.image.styledpil import StyledPilImage  # noqa: F401  (pillow check)

PAYEE = "WE3"
OUT = Path(__file__).resolve().parent.parent / "assets" / "we3-upi-qr.png"


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2

    vpa = sys.argv[1].strip()
    if "@" not in vpa or vpa.lower().startswith("placeholder"):
        print(f"'{vpa}' does not look like a UPI ID (expected something like name@bank)")
        return 1

    # No amount: one QR serves every order, and the visitor types the figure
    # shown on screen. The "open a UPI app" link carries the amount instead.
    payload = f"upi://pay?pa={quote(vpa)}&pn={quote(PAYEE)}&cu=INR"

    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=12,
        border=2,
    )
    qr.add_data(payload)
    qr.make(fit=True)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    qr.make_image(fill_color="#0F1115", back_color="white").save(OUT)

    print(f"wrote {OUT.relative_to(OUT.parent.parent)}  ({payload})")
    print('now set  qrImage: "assets/we3-upi-qr.png"  in script.js')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
