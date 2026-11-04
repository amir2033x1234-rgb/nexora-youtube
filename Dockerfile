FROM node:22-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    NEXORA_TRUSTED_PROXY=true \
    NEXORA_COOKIE_SECURE=true \
    NEXORA_DATA_DIR=/var/lib/nexora \
    NEXORA_ASSET_DIR=/var/lib/nexora/assets

WORKDIR /app
COPY --chown=node:node . .
RUN mkdir -p /var/lib/nexora/assets /var/lib/nexora/exports \
    && chown -R node:node /var/lib/nexora

USER node
VOLUME ["/var/lib/nexora"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
