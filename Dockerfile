# Kardias Cunda — yayın imajı (Railway, Render, VPS'te aynı şekilde çalışır)
# Veritabanı ve yüklenen dosyalar /data klasöründe durur: bu klasöre KALICI bir disk bağlayın.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    COOKIE_SECURE=always \
    TRUST_PROXY=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN mkdir -p /data && chown -R node:node /data
USER node

EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server/index.js"]
