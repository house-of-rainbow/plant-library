FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# nginx's entrypoint runs envsubst over files in /etc/nginx/templates, writing
# the result to /etc/nginx/conf.d. Only $BACKEND_URL / $BACKEND_HOST are
# substituted; nginx's own runtime variables (e.g. $host) are preserved.
# BACKEND_HOST is the upstream hostname used for SNI + the Host header.
ENV BACKEND_URL=http://backend:8000
ENV BACKEND_HOST=backend
# Auth defaults (auth off unless the runtime env sets otherwise). Non-secret.
ENV AUTH_DISABLED=false
ENV ENTRA_CLIENT_ID=""
ENV ENTRA_TENANT_ID="common"
ENV ENTRA_API_SCOPE=""
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
# Generates /config.js from the auth env vars at container start.
COPY docker/40-app-config.sh /docker-entrypoint.d/40-app-config.sh
RUN chmod +x /docker-entrypoint.d/40-app-config.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
