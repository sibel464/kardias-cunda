# Kardias Cunda — yayın imajı (Render, Railway, VPS'te aynı şekilde çalışır)
# Veritabanı, yüklenen dosyalar ve otomatik yedekler /data klasöründe durur: bu klasöre KALICI bir disk bağlayın.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    COOKIE_SECURE=always \
    TRUST_PROXY=1 \
    BACKUP_INTERVAL_HOURS=24 \
    BACKUP_KEEP=14 \
    INITIAL_CONTENT=admin-db

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN mkdir -p /data && chown -R node:node /data

EXPOSE 3000
# Bağlanan kalıcı disk root sahipliğinde gelebilir: açılışta sahiplik düzeltilir, uygulama yetkisiz "node" kullanıcısıyla çalışır.
# (VOLUME satırı yok: Railway kabul etmiyor; diski barındırma hizmetinin panelinden /data yoluna bağlayın.)
CMD ["sh", "-c", "chown -R node:node /data 2>/dev/null; exec setpriv --reuid=node --regid=node --init-groups node server/index.js"]
