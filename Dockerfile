# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS frontend
WORKDIR /src
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx vite build

FROM node:24-bookworm-slim AS backend
WORKDIR /src
COPY backend/package*.json ./
RUN npm ci --no-audit --no-fund
COPY backend/ ./
RUN npx tsc -p tsconfig.json && npm prune --omit=dev

FROM golang:1.25-bookworm AS awg
ARG AWG_GO_VERSION=v3.1.20260828
ARG AWG_TOOLS_VERSION=v3.1.20260812
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${AWG_GO_VERSION} https://github.com/amnezia-vpn/amneziawg-go /awg-go \
    && cd /awg-go && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/amneziawg-go .
RUN git clone --depth 1 --branch ${AWG_TOOLS_VERSION} https://github.com/amnezia-vpn/amneziawg-tools /awg-tools \
    && make -C /awg-tools/src -j"$(nproc)" \
    && install -m 755 /awg-tools/src/wg /out/awg

FROM debian:bookworm-slim AS xray
ARG XRAY_VERSION=v26.7.28
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
RUN case "${TARGETARCH}" in \
        amd64) ARCHIVE='Xray-linux-64.zip' ;; \
        arm64) ARCHIVE='Xray-linux-arm64-v8a.zip' ;; \
        *) echo "unsupported arch ${TARGETARCH}" && exit 1 ;; \
    esac \
    && BASE="https://github.com/XTLS/Xray-core/releases/download/${XRAY_VERSION}" \
    && curl -fsSL -o /tmp/xray.zip "${BASE}/${ARCHIVE}" \
    && curl -fsSL -o /tmp/xray.dgst "${BASE}/${ARCHIVE}.dgst" \
    && echo "$(awk '/^SHA2-256=/ { print $2 }' /tmp/xray.dgst)  /tmp/xray.zip" | sha256sum -c - \
    && unzip -q /tmp/xray.zip -d /out \
    && chmod 755 /out/xray

FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl iproute2 iptables openssl openvpn tini wireguard-tools \
    && rm -rf /var/lib/apt/lists/*
COPY --from=xray /out/xray /usr/local/bin/xray
COPY --from=xray /out/geoip.dat /out/geosite.dat /usr/local/share/xray/
COPY --from=awg /out/amneziawg-go /out/awg /usr/local/bin/
WORKDIR /app
COPY --from=backend /src/node_modules ./node_modules
COPY --from=backend /src/dist ./dist
COPY --from=backend /src/package.json ./package.json
COPY --from=frontend /src/dist ./public
ENV NODE_ENV=production \
    HOST=127.0.0.1 \
    PORT=3000 \
    DATA_DIR=/var/lib/brpan \
    STATIC_DIR=/app/public \
    XRAY_BIN=/usr/local/bin/xray \
    XRAY_LOCATION_ASSET=/usr/local/share/xray \
    CADDYFILE_PATH=/etc/brpan-caddy/Caddyfile \
    CADDY_CERT_DIR=/caddy-data/caddy/certificates
VOLUME ["/var/lib/brpan"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--no-warnings=ExperimentalWarning", "dist/index.js"]
