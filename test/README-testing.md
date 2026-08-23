# Rendering tests

## Why this exists

Both problems these fixtures cover fail *quietly*, with a success exit code
and no warning.

- **Equations**: without `libreoffice-math`, LibreOffice drops every OMML
  equation from the PDF. `soffice` prints a normal success line and exits 0.
- **Chinese text**: without a CJK font, the characters are still written into
  the PDF, so text extraction looks perfect — but nothing draws them and the
  reader sees empty boxes.

Neither is caught by checking exit codes, and the Chinese case is not caught
by checking extracted text either. Both scripts inspect what the PDF actually
embeds.

## Files

| File | Purpose |
|---|---|
| `make-math-fixture.py` | Generates `math-fixture.docx` — six native Word equations covering fractions, radicals, superscripts, n-ary operators, matrices, inline math, and a Greek/operator glyph-coverage row. |
| `math-fixture.docx` | The generated fixture. |
| `legacy-ole-fixture.docx` | A document using legacy Equation Editor 3.0 / MathType OLE objects, for exercising the `/inspect` detector. |
| `verify-math-rendering.sh` | Regression guard: converts the fixture and fails if equations are missing. |
| `make-cjk-fixture.py` | Generates `cjk-fixture.docx` — Chinese text in the typefaces Word actually records (SimSun, SimHei, Microsoft YaHei, KaiTi, FangSong), plus Traditional Chinese, mixed Chinese/Latin runs, CJK punctuation, full-width forms and rare characters. |
| `cjk-fixture.docx` | The generated Chinese fixture. |
| `verify-cjk-rendering.sh` | Regression guard: fails if no CJK font is embedded in the PDF. |

## Running

The verification script needs a small poppler helper image once:

```bash
printf 'FROM debian:bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*\n' | docker build -t pdfcheck -
```

Then:

```bash
docker build -t word-url-to-pdf . && ./test/verify-math-rendering.sh && ./test/verify-cjk-rendering.sh
```

Regenerate the main fixture after editing the generator:

```bash
python3 test/make-math-fixture.py
```

Regenerate the Chinese fixture after editing its generator:

```bash
python3 test/make-cjk-fixture.py
```
