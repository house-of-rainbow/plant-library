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
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
