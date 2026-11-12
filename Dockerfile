# ── Stage 1: Build & Dependencies ──
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies for native node addons (sharp, onnxruntime-node, mupdf)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .

# Set build environment
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ── Stage 2: Production Runtime ──
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Copy node_modules and built application code
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/workers ./workers
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/model ./model
COPY --from=builder /app/sql ./sql
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Ensure storage directories exist
RUN mkdir -p /app/storage /app/storage/dataset /app/storage/documents /app/storage/legends /app/storage/pages

EXPOSE 3000

CMD ["sh", "-c", "npm run migrate && npm start"]

