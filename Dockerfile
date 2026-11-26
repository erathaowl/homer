# build stage
FROM --platform=$BUILDPLATFORM node:24-alpine3.23 AS build-stage

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
ARG VERSION_TAG=latest
RUN if [ "$VERSION_TAG" != "latest" ]; then \
      VERSION_TAG="$VERSION_TAG" node -e 'const fs = require("node:fs"); const p = JSON.parse(fs.readFileSync("package.json")); p.version = process.env.VERSION_TAG.replace(/^v/, ""); fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'; \
    fi && pnpm build && cp -LR node_modules/yaml /app/runtime-yaml

# production stage
FROM alpine:3.23

ARG VERSION_TAG=latest

LABEL \
    org.label-schema.schema-version="1.0" \
    org.label-schema.version="$VERSION_TAG" \
    org.opencontainers.image.title="Homer Image" \
    org.opencontainers.image.description="A dead simple static Home-Page for your server to keep your services on hand, from a simple yaml configuration file." \
    org.opencontainers.image.ref.name="ghcr.io/erathaowl/homer:${VERSION_TAG}" \
    org.opencontainers.image.version="$VERSION_TAG" \
    org.opencontainers.image.licenses="Apache-2.0 license" \
    org.opencontainers.image.source="https://github.com/erathaowl/homer" \
    org.opencontainers.image.url="https://github.com/erathaowl/homer/pkgs/container/homer"

ENV GID=1000 \
    UID=1000 \
    PORT=8080 \
    SUBFOLDER="/_" \
    INIT_ASSETS=1 \
    IPV6_DISABLE=0 \
    ADMIN_ENABLED=0

RUN addgroup -S lighttpd -g ${GID} && adduser -D -S -u ${UID} lighttpd lighttpd && \
    apk add -U --no-cache tzdata nodejs

WORKDIR /www

COPY server /opt/homer/server
COPY --from=build-stage /app/runtime-yaml/ /opt/homer/node_modules/yaml/
ENV WEB_ROOT=/www \
    ADMIN_WEB_ROOT=/opt/homer/admin
COPY entrypoint.sh /entrypoint.sh
COPY --from=build-stage --chown=${UID}:${GID} /app/dist /www/
COPY --from=build-stage /app/dist-admin /opt/homer/admin
COPY --from=build-stage --chown=${UID}:${GID} /app/dist/assets /opt/default-assets

USER ${UID}:${GID}

HEALTHCHECK --start-period=10s --start-interval=1s --interval=30s --timeout=5s --retries=3 \
    CMD wget --no-verbose -Y off --tries=1 --spider http://127.0.0.1:${PORT}/ || exit 1

EXPOSE ${PORT}

ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
