# App Store Screenshot Generator
# Lightweight nginx container serving static files

FROM nginx:alpine

LABEL maintainer="App Store Screenshot Generator"
LABEL description="Browser-based tool for creating App Store marketing screenshots"

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy application files. Globs so every root HTML/CSS/JS module is included
# automatically — avoids shipping an image that 404s a newly-added script
# (e.g. appstore-features.js, updater.js, color-input.js, panel-resize.js).
COPY *.html /usr/share/nginx/html/
COPY *.css /usr/share/nginx/html/
COPY *.js /usr/share/nginx/html/

# Cache-busting: stamp a per-build version onto local JS/CSS references in
# index.html (e.g. app.js -> app.js?v=1718000000). index.html itself is served
# with no-cache (and isn't cached by Cloudflare), so each deploy points at fresh
# asset URLs — the CDN can't keep serving a stale build, with no manual purge.
# Only relative refs are matched ([^":?] excludes "https://" and existing "?v=").
RUN BUILD_V="$(date +%s)" && \
    sed -i -E "s@(src|href)=\"([^\":?]+\.(js|css))\"@\1=\"\2?v=${BUILD_V}\"@g" \
        /usr/share/nginx/html/index.html

# Copy assets
COPY models/ /usr/share/nginx/html/models/
COPY img/ /usr/share/nginx/html/img/

# Copy custom nginx configuration for SPA and caching
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Optional password gate (login page). Default = open so the image is valid
# before the entrypoint runs; the entrypoint rewrites it from SITE_PASSWORD.
RUN printf '%s\n' '# default: open' 'location = /auth-check { return 204; }' > /etc/nginx/appscreen-gate.conf
COPY docker/40-appscreen-auth.sh /docker-entrypoint.d/40-appscreen-auth.sh
RUN chmod +x /docker-entrypoint.d/40-appscreen-auth.sh

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
