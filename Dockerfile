# syntax=docker/dockerfile:1.7

# ─── Build stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Install deps (leverages Docker layer cache).
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Compile.
COPY tsconfig.json build.mjs ./
COPY src ./src
RUN node ./build.mjs

# Prune to production deps for the runtime image.
RUN npm prune --omit=dev

# ─── Runtime stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Cloud Run sets $PORT (defaults to 8080); the server reads it directly.
ENV PORT=8080

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

EXPOSE 8080

# Drop root for safety.
USER node

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
