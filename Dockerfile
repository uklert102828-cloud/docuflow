FROM node:24-bookworm-slim AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    SOFFICE_BIN=soffice \
    OCRMY_PDF_BIN=ocrmypdf \
    PYTHON_BIN=/opt/pdf2docx/bin/python
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    fonts-noto-cjk \
    fonts-liberation \
    python3 \
    python3-venv \
    ocrmypdf \
    tesseract-ocr-eng \
    tesseract-ocr-chi-sim \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m venv /opt/pdf2docx \
  && /opt/pdf2docx/bin/pip install --no-cache-dir pdf2docx
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=web-build /app/dist ./dist
COPY server ./server
RUN mkdir -p /app/data /home/node/.config && chown -R node:node /app /home/node/.config
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
