# ── Stage 1: Build ──
FROM oven/bun:1-debian AS build

WORKDIR /app

# Cache dependencies (separate layer)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile || bun install

# Copy source code
COPY ./src ./src
COPY tsconfig.json ./

# Set production environment
ENV NODE_ENV=production

# Compile to a single binary matching the container's architecture.
# No explicit --target: Bun auto-detects the current platform (linux-arm64 on
# Apple Silicon Docker, linux-x64 on amd64 hosts).
RUN bun build \
  --compile \
  --minify-whitespace \
  --minify-syntax \
  --outfile server \
  src/index.ts

# Verify the binary was created
RUN ls -lh /app/server

# ── Stage 2: Runtime (Debian slim - compatible glibc) ──
FROM debian:bookworm-slim

# Install only the minimal runtime libs the Bun binary needs
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary
COPY --from=build /app/server server

# Make sure it's executable
RUN chmod +x /app/server

ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

LABEL org.opencontainers.image.title="elysia-servicenow-mcp-remote"
LABEL org.opencontainers.image.description="ServiceNow MCP Server (Remote) - ElysiaJS + Bun"
LABEL org.opencontainers.image.version="1.0.0"

CMD ["./server"]
