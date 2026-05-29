# Publicly downloadable (exportable) OneDrive Word files as PDF
# with stable (constant) URLs (links) [built through ChatGPT 5.5] 

This app converts public OneDrive Word direct-download URLs to PDF on demand.

This version supports saved conversion links and improved OneDrive filename detection:

- Create a stable PDF URL such as `/pdf/abc12345`
- Update the source Word URL later while keeping `/pdf/abc12345` unchanged
- Delete saved links
- Store saved links in `data/links.json`
- Try to detect filenames from `Content-Disposition`, redirect `Location` headers, and OneDrive “Object moved” HTML `<a href="...Document.docx?...">` links

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

For public deployment, set `SECRET_TOKEN`. Management pages and PDF URLs will require `?token=...`.

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

Temporary conversion mode from previous versions still works:

```text
GET /convert?url=<encoded-public-word-url>
```

## Notes

The app follows OneDrive redirects and preserves temporary cookies during the download. It still restricts allowed hosts to avoid becoming a general-purpose URL fetcher.


## Filename detection

The app tries to detect the original Word filename and use the same base name for the returned PDF. It checks `Content-Disposition`, redirect `Location` headers, and OneDrive “Object moved” HTML links such as `<a href="/Documents/Deneme_Dosya.docx?...">`. If no filename is detected, it keeps the existing default PDF filename behavior (`document.pdf`).


## v6 security model

This version is designed for online personal hosting:

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


## v7 UI update

The saved conversion links section now uses an accordion-style interface. Each link shows only the title, public PDF path, and quick Open/Copy actions at first. Expanding a link reveals the editable source Word URL, metadata, and delete action.


## v10 UI note

Each expanded saved-link card now includes an explicit **Save changes** button. Use it to save a changed title/label or source Word URL while keeping the same public PDF URL.
