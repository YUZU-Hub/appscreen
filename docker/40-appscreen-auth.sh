#!/bin/sh
# Generate the password gate for the static site from the SITE_PASSWORD env var.
# Runs before nginx starts (the nginx image executes /docker-entrypoint.d/*.sh).
#
# Unlike HTTP Basic Auth (browser popup), this gates the site behind a real login
# page: /login.html hashes the entered password (SHA-256, salted) into a cookie,
# and nginx compares that cookie against the same hash computed here. No valid
# cookie -> 302 to /login.html for every URL except the login page itself,
# /auth-check (used by the login page to validate), /logout and /health.
#
#   SITE_PASSWORD  - if set & non-empty, the site requires login. Unset = open.
#
# The password is provided at runtime only — never baked into the image. Only its
# salted SHA-256 ever appears in config, cookies, or network traffic.
set -eu

GATE_CONF="/etc/nginx/appscreen-gate.conf"
SALT="appscreen-v1:"

if [ -n "${SITE_PASSWORD:-}" ]; then
    HASH=$(printf '%s%s' "$SALT" "$SITE_PASSWORD" | sha256sum | awk '{print $1}')
    cat > "$GATE_CONF" <<EOF
# Generated at container start — password gate ENABLED.
set \$appscreen_need_auth 1;
if (\$cookie_appscreen_auth = "$HASH") { set \$appscreen_need_auth 0; }
if (\$uri ~ "^/(login\\.html|auth-check|logout|health)\$") { set \$appscreen_need_auth 0; }
if (\$appscreen_need_auth) { return 302 /login.html; }

# Login page probe: 204 when the cookie is right, 401 otherwise.
location = /auth-check {
    if (\$cookie_appscreen_auth = "$HASH") { return 204; }
    return 401;
}

location = /logout {
    add_header Set-Cookie "appscreen_auth=; Path=/; Max-Age=0; SameSite=Lax";
    return 302 /login.html;
}
EOF
    echo "[appscreen-auth] Password gate ENABLED (login page)"
else
    cat > "$GATE_CONF" <<'EOF'
# Generated at container start — SITE_PASSWORD not set, site is OPEN.
location = /auth-check { return 204; }
EOF
    echo "[appscreen-auth] SITE_PASSWORD not set - site is OPEN"
fi
