# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=26.2.0

FROM node:${NODE_VERSION}-bookworm AS crew-builder

COPY --from=rust:1.96-bookworm /usr/local/cargo /usr/local/cargo
COPY --from=rust:1.96-bookworm /usr/local/rustup /usr/local/rustup
ENV PATH="/usr/local/cargo/bin:${PATH}"

WORKDIR /opt/rusty-crew
COPY --from=rusty_crew . .
RUN npm ci \
    && npm run build:native \
    && rm -rf target \
    && npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

RUN npm install --global tsx@4.22.4 \
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

EXPOSE 9347
CMD ["sh", "-c", "npm run service:preflight && exec npm run service:start"]
