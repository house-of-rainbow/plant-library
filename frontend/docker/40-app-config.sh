#!/bin/sh
# Generates /usr/share/nginx/html/config.js from environment variables at
# container start, so the SPA can read auth config at runtime (window.__APP_CONFIG__).
# Runs via nginx's /docker-entrypoint.d/ mechanism before nginx starts.
set -eu

CONFIG_PATH=/usr/share/nginx/html/config.js

cat > "$CONFIG_PATH" <<EOF
window.__APP_CONFIG__ = {
  authDisabled: ${AUTH_DISABLED:-false},
  entraClientId: "${ENTRA_CLIENT_ID:-}",
  entraTenantId: "${ENTRA_TENANT_ID:-}",
  entraApiScope: "${ENTRA_API_SCOPE:-}"
};
EOF

echo "Generated $CONFIG_PATH (authDisabled=${AUTH_DISABLED:-false})"
