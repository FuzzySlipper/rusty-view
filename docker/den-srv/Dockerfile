# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=26.2.0

FROM node:${NODE_VERSION}-bookworm AS crew-builder

COPY --from=rust:1.96-bookworm /usr/local/cargo /usr/local/cargo
COPY --from=rust:1.96-bookworm /usr/local/rustup /usr/local/rustup
ENV PATH="/usr/local/cargo/bin:${PATH}"

WORKDIR /opt/rusty-crew
COPY --from=rusty_crew . .
RUN npm install --global npm@11.16.0 \
    && npm ci \
    && npm run build:native \
    && rm -rf target \
    && npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm AS view-builder

RUN npm install --global pnpm@10.15.0

WORKDIR /opt/rusty-view
COPY . .
RUN pnpm install --frozen-lockfile \
    && pnpm exec nx build rusty-view \
    && node tools/fix-package-esm-specifiers.mjs --write

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

RUN npm install --global npm@11.16.0 tsx@4.22.4 \
    && install -d /opt/rusty-view/site

ARG CREW_REVISION=unknown
ARG VIEW_REVISION=unknown
LABEL org.opencontainers.image.title="Rusty View Crew Runtime" \
      org.opencontainers.image.description="Rusty Crew runtime for an externally mounted Rusty View frontend" \
      org.opencontainers.image.revision="${VIEW_REVISION}" \
      io.rusty-view.crew-revision="${CREW_REVISION}"

ENV NODE_ENV=production \
    RUSTY_CREW_STATIC_DIR=/opt/rusty-view/site

WORKDIR /opt/rusty-crew
COPY --from=crew-builder /opt/rusty-crew/ /opt/rusty-crew/
COPY --from=view-builder /opt/rusty-view/dist/apps/rusty-view/browser/ /opt/rusty-view/site/
COPY scripts/deploy-config/rusty-view-config.production.js /opt/rusty-view/site/rusty-view-config.js

EXPOSE 9347
CMD ["sh", "-c", "npm run service:preflight && exec npm run service:start"]
