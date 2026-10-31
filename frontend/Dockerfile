# Build the Angular app, then serve the static output with nginx.
FROM node:26-bookworm-slim AS build

WORKDIR /app
ENV NG_CLI_ANALYTICS=false

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM nginx:stable-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/40-sync-config.sh /docker-entrypoint.d/40-sync-config.sh
RUN chmod +x /docker-entrypoint.d/40-sync-config.sh
COPY --from=build /app/dist/the-noter/browser /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
