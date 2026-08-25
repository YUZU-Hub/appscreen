# appscreen MCP server — generates App Store screenshots over MCP.
# Multi-stage: compile TypeScript, then a slim runtime with the fonts that
# @napi-rs/canvas needs to render text (a Linux base ships none by default).

# ---- build stage ----
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production

# Fonts: a sans-serif family (DejaVu/Liberation) + color emoji, and fontconfig
# so @napi-rs/canvas can resolve "sans-serif" and emoji glyphs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fontconfig \
        fonts-dejavu-core \
        fonts-liberation \
        fonts-noto-color-emoji \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Production dependencies only (skip lifecycle scripts; dist is copied below).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Compiled server + vendored laurel SVG assets.
COPY --from=build /app/dist ./dist
COPY assets ./assets

# HTTP transport by default (override CMD for stdio).
ENV MCP_TRANSPORT=http
ENV PORT=3000
# In a container, the project store MUST be on a mounted volume — otherwise every
# redeploy wipes all projects. With this flag the server detects a non-mounted
# store and refuses writes (HTTP 507) instead of accepting doomed data.
# Override with REQUIRE_PERSISTENT_STORE=0 for throwaway/test runs.
ENV REQUIRE_PERSISTENT_STORE=1
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js", "--http"]
