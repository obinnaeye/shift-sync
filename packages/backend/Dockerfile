# ── Stage 1: Install dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate

WORKDIR /app

# Copy manifests only (better layer caching)
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/backend/package.json ./packages/backend/

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.22.0 --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/backend/node_modules ./packages/backend/node_modules

COPY pnpm-workspace.yaml package.json ./
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Build shared types first, then backend
RUN pnpm --filter @shiftsync/shared build
RUN pnpm --filter @shiftsync/backend build

# Generate Prisma client
RUN cd packages/backend && npx prisma generate

# ── Stage 3: Production image ──────────────────────────────────────────────────
FROM node:20-alpine AS runner

RUN corepack enable && corepack prepare pnpm@10.22.0 --activate

WORKDIR /app

ENV NODE_ENV=production

# Only copy what's needed at runtime
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/node_modules ./packages/backend/node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist

# Prisma schema + generated client (required for migrate deploy and runtime)
COPY --from=builder /app/packages/backend/prisma ./packages/backend/prisma
COPY --from=builder /app/packages/backend/package.json ./packages/backend/package.json

COPY package.json pnpm-workspace.yaml ./

EXPOSE 4000

# Run migrations then start server
CMD ["sh", "-c", "cd packages/backend && npx prisma migrate deploy && node dist/server.js"]
