FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-core fonts-dejavu fonts-liberation ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./

ENV PORT=8080
EXPOSE 8080
CMD ["npm", "start"]
