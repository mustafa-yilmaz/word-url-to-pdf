#!/usr/bin/env bash
# Regression guard for Chinese (CJK) rendering.
#
# The failure this catches is quiet: with no CJK font installed, LibreOffice
# still writes the Chinese characters into the PDF, so `pdftotext` extracts
# them perfectly and any text-based check passes - but nothing draws them and
# the reader sees a page of empty boxes. The only reliable signal is whether a
# CJK font was actually embedded.
#
# Usage:  docker build -t word-url-to-pdf . && ./test/verify-cjk-rendering.sh
set -euo pipefail

IMAGE="${1:-word-url-to-pdf}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

if [ ! -f "$HERE/cjk-fixture.docx" ]; then
  echo "Fixture missing; generating it."
  python3 "$HERE/make-cjk-fixture.py"
fi

echo "1/4  Checking a CJK font is installed in $IMAGE"
ZH_FONTS=$(docker run --rm "$IMAGE" bash -c 'fc-list :lang=zh | wc -l')
[ "$ZH_FONTS" -gt 0 ] || { echo "FAIL: no font supports Chinese. Chinese text will render as empty boxes."; exit 1; }
echo "     $ZH_FONTS fonts support Chinese"

echo "2/4  Converting the fixture"
docker run --rm -v "$HERE:/in:ro" -v "$OUT:/out" "$IMAGE" \
  soffice --headless --nologo --nofirststartwizard --convert-to pdf --outdir /out /in/cjk-fixture.docx >/dev/null 2>&1
[ -f "$OUT/cjk-fixture.pdf" ] || { echo "FAIL: no PDF produced."; exit 1; }

echo "3/4  Checking a CJK font was embedded (the tofu check)"
# This is the assertion that matters. Extracted text looks correct even when
# every character renders as an empty box, so the font list is the real signal.
EMBEDDED=$(docker run --rm -v "$OUT:/pdf" pdfcheck pdffonts /pdf/cjk-fixture.pdf 2>/dev/null | tail -n +3 | awk '{print $1}')
echo "$EMBEDDED" | grep -qi "cjk" || {
  echo "FAIL: no CJK font embedded in the PDF - Chinese text is rendering as empty boxes."
  echo "Fonts found: $EMBEDDED"
  exit 1
}

echo "4/4  Checking the serif/sans distinction survived"
echo "$EMBEDDED" | grep -qi "serifcjk" || { echo "FAIL: no CJK serif face - SimSun/宋体 text lost its typeface."; exit 1; }
echo "$EMBEDDED" | grep -qi "sanscjk"  || { echo "FAIL: no CJK sans face - SimHei/黑体 text lost its typeface."; exit 1; }

CJK_CHARS=$(docker run --rm -v "$OUT:/pdf" pdfcheck pdftotext -enc UTF-8 /pdf/cjk-fixture.pdf - 2>/dev/null \
  | python3 -c "import sys; print(sum(1 for c in sys.stdin.read() if '一' <= c <= '鿿'))")
[ "$CJK_CHARS" -gt 100 ] || { echo "FAIL: expected Chinese text missing from the PDF (found $CJK_CHARS ideographs)."; exit 1; }

echo "PASS: Chinese text renders into the PDF ($CJK_CHARS ideographs, CJK fonts embedded)."
