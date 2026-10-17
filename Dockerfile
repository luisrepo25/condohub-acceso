# Acceso (Next.js 14, solo API). Construir: docker build -t condohub-acceso services/acceso
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.mjs ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "require('net').connect(3001,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"
# Por entorno: KEYCLOAK_ISSUER, KEYCLOAK_JWKS
CMD ["npx", "next", "start", "-p", "3001"]