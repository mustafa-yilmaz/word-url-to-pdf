<h1 align="center">
<p>Publicly </p>
<p>downloadable (exportable) OneDrive Word files</p>
<p>as PDF</p>
</h1>

<h3 align="center">
<b>with stable (constant, unchanged) URLs (links)</b>  
</h3>
<h3 align="center">
<b>[built through ChatGPT 5.5]</b>  
</h3>

----------

This app aims to provide (imitate) the same functionality of Google WorkSpace (Google Drive)'s `http://...URL of the file.../export?format=pdf` feature - explained <a href="https://support.google.com/a/users/answer/13004062?hl=en#share_PDF_links&zippy=%2Clearn-how:~:text=http%3A//docs.google.com/document/d/%3Cdoc_id%3E/export%3Fformat%3Dpdf" rel="nofollow">here</a> - for Microsoft 365 OneDrive files.

----------

<br>
<br>
<br>
This app converts public OneDrive Word direct-download URLs to PDF on demand.

<br>
<br>

- Create stable (unchanged) URLs (such as `yourdomain.com/pdf/abc12345` ) to download (export) OneDrive Word files as PDF publicly
- Update the URL of the source Word file later while keeping `yourdomain.com/pdf/abc12345` unchanged
- Delete saved links
- Store saved links in `data/links.json`


## Run on macOS with Docker

Build:

```bash
docker build -t word-url-to-pdf .
```

Run with persistent storage:

```bash
docker run --rm -p 8081:8080 \
  -v "$PWD/data:/app/data" \
  -e DATA_DIR="/app/data" \
  -e ALLOWED_HOST_SUFFIXES="1drv.ms,onedrive.live.com,live.com,microsoftpersonalcontent.com,my.microsoftpersonalcontent.com" \
  word-url-to-pdf
```

Open:

```text
http://localhost:8081
```

## Optional admin token

For public deployment, set `SECRET_TOKEN`.
<br>Management (setting) pages will require `?token=...` while PDF URLs are publicly visible.

<br>

```bash
docker run --rm -p 8081:8080 \
  -v "$PWD/data:/app/data" \
  -e DATA_DIR="/app/data" \
  -e SECRET_TOKEN="change-this-secret" \
  -e ALLOWED_HOST_SUFFIXES="1drv.ms,onedrive.live.com,live.com,microsoftpersonalcontent.com,my.microsoftpersonalcontent.com" \
  word-url-to-pdf
```

Then open:

```text
http://localhost:8081/?token=change-this-secret
```

## API

List saved links:

```text
GET /api/links
```

Convert a saved link:

```text
GET /pdf/:id
```

Report the mathematical formulas found in a source document:

```text
GET /inspect/:id
GET /inspect?url=<encoded-public-word-url>
```


## Notes

1. This app follows OneDrive redirects and preserves temporary cookies during the download. It still restricts allowed hosts to avoid becoming a general-purpose URL fetcher.
2. This app, via Docker, uses LibreOffice’s (not Microsoft Office’s own) rendering engine to convert OneDrive files to PDF. Therefore, some design or formatting issues may occur in the resulting PDF output.  





## Additional security points

This app is designed for online personal hosting:

- `/` is the private admin page when `SECRET_TOKEN` is set.
- `/api/links`, `/links`, `/links/:id/update`, and `/links/:id/delete` are private when `SECRET_TOKEN` is set.
- `/pdf/:id` is public, so you can share generated PDF URLs without sharing the admin token.
- Saved link IDs are long random 32-character hexadecimal IDs.
- `/pdf/:id` has a simple in-memory rate limit. Configure it with `PUBLIC_PDF_RATE_LIMIT_PER_MINUTE` or set it to `0` to disable it.
- `/convert?url=...` remains available for testing, but is private when `SECRET_TOKEN` is set. For public sharing, use saved `/pdf/:id` links.

Example production-style local run:

```bash
docker run --rm -p 8081:8080   -v "$PWD/data:/app/data"   -e DATA_DIR="/app/data"   -e SECRET_TOKEN="replace-with-a-long-random-secret"   -e PUBLIC_PDF_RATE_LIMIT_PER_MINUTE="30"   -e ALLOWED_HOST_SUFFIXES="1drv.ms,onedrive.live.com,live.com,microsoftpersonalcontent.com,my.microsoftpersonalcontent.com"   word-url-to-pdf
```

Admin page:

```text
http://localhost:8081/?token=replace-with-a-long-random-secret
```

Public PDF URLs look like:

```text
http://localhost:8081/pdf/8f4c2b9e6d1a47b98c41f0d2abcd12345678
```

<br>
<br>
<br>


## Mathematical formula rendering

Word equations are rendered into the generated PDF. This needs the
`libreoffice-math` package, which the `Dockerfile` installs alongside
`libreoffice-writer`.

Two kinds of equations occur in `.docx` files, and they behave differently:

- **Native Word equations (OMML)** — inserted with Word's *Insert > Equation*.
  These are fully typeset into the PDF: fractions, radicals, superscripts and
  subscripts, n-ary operators (integrals, summations) with limits, matrices,
  and inline equations, using the `OpenSymbol` and DejaVu math fonts already
  present in the image.
- **Legacy Equation Editor 3.0 / MathType objects** — stored as embedded OLE
  objects. These are drawn from the preview bitmap Word saved with them, so
  they do appear in the PDF, but they are not re-typeset and will not look
  sharper than the stored preview.

### Why the Math component matters

Without `libreoffice-math`, LibreOffice **silently drops every equation**: it
logs a normal success message, exits with code 0, and returns a PDF in which
the formulas are simply absent. The exit code reveals nothing, so this can go
unnoticed indefinitely.

The app guards against that in three places:

- At startup it probes for the Math component and logs
  `Word equation rendering: enabled`, or a warning if it is missing.
- During conversion, when the component is missing and the document contains
  equations, it logs how many will be lost. This check runs only when the
  component is absent, so a healthy deployment pays nothing for it.
- `test/verify-math-rendering.sh` fails if equations stop rendering, so a
  future image change cannot reintroduce the problem quietly.

### Inspecting a document

`GET /inspect/:id` and `GET /inspect?url=...` report which equations a source
document actually contains, so a rendering problem can be diagnosed instead of
guessed at. Both are private when `SECRET_TOKEN` is set, and both honour the
same host allow-list as conversion. The admin page exposes this as the
**Check formulas** action on each saved link.

```text
GET /inspect/8f4c2b9e6d1a47b98c41f0d2abcd12345678?token=...
```

```json
{
  "sourceFilename": "lecture-notes",
  "format": "docx",
  "readable": true,
  "equations": {
    "omml": 6,
    "ommlDisplay": 5,
    "ommlInline": 1,
    "legacyEquationObjects": 0,
    "embeddedObjects": 0
  },
  "images": 0,
  "embeddedParts": [],
  "renderability": {
    "libreOfficeMathAvailable": true,
    "ommlWillRender": true,
    "ommlWillBeDropped": false,
    "legacyRendersAsPreviewImageOnly": false
  }
}
```

Equation counting reads `word/document.xml` straight out of the `.docx` zip and
adds no npm dependencies. The old binary `.doc` format cannot be inspected; the
endpoint reports that rather than guessing.

### Verifying after a change

```bash
docker build -t word-url-to-pdf . && ./test/verify-math-rendering.sh
```

See `test/README-testing.md` for the fixtures and the one-time helper image.

## Screen Shots and Usage Instructions

<br>
<br>
<br>

<b>First, get (generate) the OneDrive URL (link)</b> with the four steps shown below.

<br>
<br>
<br>

<b>1.</b> <br>
<br>
<img width="2549" height="398" alt="Image" src="https://github.com/user-attachments/assets/fa13fd96-29a9-4691-ad90-2551dccac22d" />
<br>
<br>

<b>2.</b> <br>
<img width="459" height="291" alt="Image" src="https://github.com/user-attachments/assets/7923d36b-da9a-496a-8e5d-b72f435d1257" />
<br>
<br>

<b>3.</b> <br>
<img width="464" height="569" alt="Image" src="https://github.com/user-attachments/assets/44613cc4-359b-4836-8ec6-c0bad47f72e9" />
<br>
<br>

<b>4.</b> <br>
<img width="454" height="285" alt="Image" src="https://github.com/user-attachments/assets/1e04b6cc-d4f3-462d-9245-6987c7823fe6" />



<br>
<br>
<br>


<b>Then, paste the OneDrive URL (link) in the relevant field in the app as shown below.</b>

<b>Note (Attention):</b> Do not forget to add `&download=1` at the end of the OneDrive URL (link).



<br>
<br>
<br>



<img width="1026" height="808" alt="Image" src="https://github.com/user-attachments/assets/44bf4b87-45bf-40d0-bc7d-e4ccfb885fff" />

<br>
<br>
<br>

## ...

<img width="1016" height="531" alt="Image" src="https://github.com/user-attachments/assets/a9251198-7b4a-4a27-9581-6473e70e7bea" />

<br>
<br>
<br>

<b>PDF files can always be downloaded publicly (anonymously, without logging into any system) through permanent and stable (umchanged) URLs generated by the app.</b>
<br>
<br>
<img width="661" height="435" alt="Image" src="https://github.com/user-attachments/assets/2d1fce0f-4762-4ad2-83fb-aaeeca6a3700" />

<br>
<br>
