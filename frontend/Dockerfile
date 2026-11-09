# Build the Angular app, then serve the static output with nginx.
FROM node:26-bookworm-slim AS build

WORKDIR /app
ENV NG_CLI_ANALYTICS=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error

COPY . .
# --ignore-scripts skips the `prebuild` hook that reads the repository-root
# .env. There is no .env in the image build context (credentials must not be
# baked in), and /sync-config.json is written at container start by
# docker-entrypoint.d/40-sync-config.sh instead. Skipping the hook avoids the
# misleading "Sync config: disabled" build warning.
RUN npm run build --ignore-scripts


FROM nginx:stable-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/40-sync-config.sh /docker-entrypoint.d/40-sync-config.sh
RUN chmod +x /docker-entrypoint.d/40-sync-config.sh
COPY --from=build /app/dist/the-noter/browser /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
