FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-core libreoffice-math fonts-dejavu fonts-liberation fonts-noto-cjk ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Map the CJK typefaces Word names in .docx files onto the Noto CJK fonts
# installed above, so Chinese text renders with Chinese glyph forms.
COPY fontconfig/99-ms-cjk-substitutions.conf /etc/fonts/conf.d/99-ms-cjk-substitutions.conf
RUN fc-cache -f >/dev/null

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
