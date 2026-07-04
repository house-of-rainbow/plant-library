FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# nginx's entrypoint runs envsubst over files in /etc/nginx/templates, writing
# the result to /etc/nginx/conf.d. Only $BACKEND_URL is substituted; nginx's own
# runtime variables (e.g. $host) are preserved.
ENV BACKEND_URL=http://backend:8000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
