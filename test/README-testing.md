# Math rendering tests

## Why this exists

LibreOffice drops native Word equations (OMML) from the PDF **silently** when
the `libreoffice-math` package is absent: `soffice` prints a normal success
line and exits 0, and the PDF simply has no formulas in it. Checking exit
codes does not catch this, so the fixture below checks the PDF's contents.

## Files

| File | Purpose |
|---|---|
| `make-math-fixture.py` | Generates `math-fixture.docx` — six native Word equations covering fractions, radicals, superscripts, n-ary operators, matrices, inline math, and a Greek/operator glyph-coverage row. |
| `math-fixture.docx` | The generated fixture. |
| `legacy-ole-fixture.docx` | A document using legacy Equation Editor 3.0 / MathType OLE objects, for exercising the `/inspect` detector. |
| `verify-math-rendering.sh` | Regression guard: converts the fixture and fails if equations are missing. |

## Running

The verification script needs a small poppler helper image once:

```bash
printf 'FROM debian:bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*\n' | docker build -t pdfcheck -
```

Then:

```bash
docker build -t word-url-to-pdf . && ./test/verify-math-rendering.sh
```

Regenerate the main fixture after editing the generator:

```bash
python3 test/make-math-fixture.py
```
