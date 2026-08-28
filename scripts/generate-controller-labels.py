#!/usr/bin/env python3
"""Render private controller setup manifests as printable QR labels."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from reportlab.graphics import renderPDF
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


INCH = 72
LABEL_WIDTH = 2.625 * INCH
LABEL_HEIGHT = 1.0 * INCH
LEFT_MARGIN = 0.1875 * INCH
TOP_MARGIN = 0.5 * INCH
HORIZONTAL_PITCH = 2.75 * INCH
VERTICAL_PITCH = 1.0 * INCH


def load_manifest(path: Path) -> dict[str, str | int]:
    manifest = json.loads(path.read_text())
    if manifest.get("version") != 1 or not str(manifest.get("setupPayload", "")).startswith(
        "modreef://setup?v=1&"
    ):
        raise ValueError(f"Unsupported controller manifest: {path}")
    return manifest


def draw_qr(pdf: canvas.Canvas, payload: str, x: float, y: float, size: float) -> None:
    widget = qr.QrCodeWidget(payload)
    bounds = widget.getBounds()
    drawing = Drawing(size, size, transform=[
        size / (bounds[2] - bounds[0]), 0,
        0, size / (bounds[3] - bounds[1]),
        0, 0,
    ])
    drawing.add(widget)
    renderPDF.draw(drawing, pdf, x, y)


def fit_text(text: str, maximum_width: float, preferred: float, minimum: float) -> float:
    size = preferred
    while size > minimum and stringWidth(text, "Helvetica-Bold", size) > maximum_width:
        size -= 0.25
    return size


def draw_label(pdf: canvas.Canvas, manifest: dict[str, str | int], x: float, y: float) -> None:
    navy = colors.HexColor("#061E42")
    cyan = colors.HexColor("#20B7EC")
    pdf.setStrokeColor(cyan)
    pdf.setLineWidth(0.65)
    pdf.roundRect(x + 2, y + 2, LABEL_WIDTH - 4, LABEL_HEIGHT - 4, 7, stroke=1, fill=0)

    qr_size = 0.78 * INCH
    draw_qr(pdf, str(manifest["setupPayload"]), x + 7, y + 7, qr_size)

    text_x = x + 0.94 * INCH
    max_width = LABEL_WIDTH - 0.99 * INCH
    pdf.setFillColor(navy)
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(text_x, y + 54, "modREEF")

    label = str(manifest["label"])
    pdf.setFont("Helvetica-Bold", fit_text(label, max_width, 9.5, 7))
    pdf.drawString(text_x, y + 39, label)

    pdf.setFont("Helvetica-Bold", 8)
    pdf.setFillColor(cyan)
    pdf.drawString(text_x, y + 26, f"SETUP ID {manifest['setupId']}")

    pdf.setFillColor(navy)
    pdf.setFont("Helvetica", 6.5)
    pdf.drawString(text_x, y + 14, f"Serial ...{str(manifest['hardwareSerial'])[-8:]}")
    pdf.setFont("Helvetica-Bold", 6.5)
    pdf.drawString(text_x, y + 6, "Scan in modREEF to set up")


def render_sheet(manifests: list[dict[str, str | int]], output: Path, copies: int) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(output), pagesize=letter, pageCompression=1)
    entries = [manifest for manifest in manifests for _ in range(copies)]
    for index, manifest in enumerate(entries):
        page_index = index % 30
        if index and page_index == 0:
            pdf.showPage()
        column = page_index % 3
        row = page_index // 3
        x = LEFT_MARGIN + column * HORIZONTAL_PITCH
        y = letter[1] - TOP_MARGIN - (row + 1) * VERTICAL_PITCH
        draw_label(pdf, manifest, x, y)
    pdf.save()


def render_individual(manifest: dict[str, str | int], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(output), pagesize=(LABEL_WIDTH, LABEL_HEIGHT), pageCompression=1)
    draw_label(pdf, manifest, 0, 0)
    pdf.save()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifests", nargs="+", type=Path)
    parser.add_argument("--output", type=Path, default=Path("output/pdf/modreef-prototype-controller-labels.pdf"))
    parser.add_argument("--copies", type=int, default=3)
    args = parser.parse_args()
    if args.copies < 1:
        raise SystemExit("--copies must be at least 1")

    manifests = [load_manifest(path) for path in args.manifests]
    render_sheet(manifests, args.output, args.copies)
    for manifest in manifests:
        render_individual(
            manifest,
            args.output.with_name(f"modreef-controller-{str(manifest['setupId']).lower()}-label.pdf"),
        )
    print(f"Rendered {len(manifests)} controller identities to {args.output}")


if __name__ == "__main__":
    main()
