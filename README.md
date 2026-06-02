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

For public deployment, set `SECRET_TOKEN`. Management (setting) pages will require `?token=...` while PDF URLs are publicly visible.

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

## Screen Shots and Usage Instructions

<b>First get the OneDrive URL (link)</b> (with the four steps shown below)

<b>1.</b> <br>
<img width="2549" height="398" alt="Image" src="https://github.com/user-attachments/assets/fa13fd96-29a9-4691-ad90-2551dccac22d" />
<br>
<br>

<b>2.</b> <br>
<img width="459" height="291" alt="Image" src="https://github.com/user-attachments/assets/44a3531e-f9a3-4896-8165-6daf3b265d15" />
<br>
<br>

3. <br>
<img width="464" height="569" alt="Image" src="https://github.com/user-attachments/assets/568ce9ac-803e-4a5c-9b79-44f1d6e2d5a5" />
<br>
<br>

4. <br>
<img width="454" height="285" alt="Image" src="https://github.com/user-attachments/assets/ce571fb0-3760-431a-89ae-9d96626fdce1" />



<br>
<br>
<br>


<b>Paste the OneDrive link in the relevant field in the app as shown below</b>

<b>Note (Attention):</b> Do not forget to add `&download=1` at the end of the OneDrive link.

<img width="1026" height="808" alt="Image" src="https://github.com/user-attachments/assets/44bf4b87-45bf-40d0-bc7d-e4ccfb885fff" />

<br>
<br>
<br>

## ...

<img width="1016" height="531" alt="Image" src="https://github.com/user-attachments/assets/a9251198-7b4a-4a27-9581-6473e70e7bea" />

