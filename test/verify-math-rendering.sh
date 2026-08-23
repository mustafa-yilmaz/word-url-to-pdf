#!/usr/bin/env bash
# Regression guard for Word equation rendering.
#
# Converts test/math-fixture.docx inside the built image and fails if the
# equations are missing from the PDF. Without the libreoffice-math package
# LibreOffice drops equations silently and still exits 0, so checking the exit
# code alone does not catch this.
#
# Usage:  docker build -t word-url-to-pdf . && ./test/verify-math-rendering.sh
set -euo pipefail

IMAGE="${1:-word-url-to-pdf}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

if [ ! -f "$HERE/math-fixture.docx" ]; then
  echo "Fixture missing; generating it."
  python3 "$HERE/make-math-fixture.py"
fi

echo "1/4  Checking the Math component is installed in $IMAGE"
docker run --rm "$IMAGE" test -r /usr/lib/libreoffice/share/registry/math.xcd \
  || { echo "FAIL: libreoffice-math is not installed. Word equations will be dropped."; exit 1; }

echo "2/4  Converting the fixture"
docker run --rm -v "$HERE:/in:ro" -v "$OUT:/out" "$IMAGE" \
  soffice --headless --nologo --nofirststartwizard --convert-to pdf --outdir /out /in/math-fixture.docx >/dev/null 2>&1
[ -f "$OUT/math-fixture.pdf" ] || { echo "FAIL: no PDF produced."; exit 1; }

echo "3/4  Checking equations survived into the PDF"
# OpenSymbol carries the math glyphs; if no math font is embedded, the
# equations were dropped rather than rendered.
if ! docker run --rm -v "$OUT:/pdf" pdfcheck pdffonts /pdf/math-fixture.pdf 2>/dev/null | grep -qi opensymbol; then
  echo "FAIL: no math font embedded in the PDF - the equations were dropped."
  echo "Hint: build the pdfcheck helper first (see test/README-testing.md)."
  exit 1
fi

MISSING=0
for glyph in "∫" "∑" "√" "π" "α"; do
  docker run --rm -v "$OUT:/pdf" pdfcheck pdftotext -enc UTF-8 /pdf/math-fixture.pdf - 2>/dev/null \
    | grep -q "$glyph" || { echo "  missing glyph: $glyph"; MISSING=1; }
done
[ "$MISSING" -eq 0 ] || { echo "FAIL: expected math glyphs are absent from the PDF."; exit 1; }

echo "4/4  Checking legacy Equation Editor 3.0 / MathType previews survive"
docker run --rm -v "$HERE:/in:ro" -v "$OUT:/out" "$IMAGE" \
  soffice --headless --nologo --nofirststartwizard --convert-to pdf --outdir /out /in/legacy-ole-fixture.docx >/dev/null 2>&1
IMG_COUNT=$(docker run --rm -v "$OUT:/pdf" pdfcheck pdfimages -list /pdf/legacy-ole-fixture.pdf 2>/dev/null | tail -n +3 | grep -c image || true)
[ "$IMG_COUNT" -ge 2 ] || { echo "FAIL: legacy equation previews missing (found $IMG_COUNT, expected 2)."; exit 1; }

echo "PASS: Word equations render into the PDF."
