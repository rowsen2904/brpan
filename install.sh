#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root: sudo ./install.sh" >&2
    exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose plugin is missing" >&2
    exit 1
fi

cat >/etc/sysctl.d/99-brpan.conf <<'EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
EOF
sysctl --system >/dev/null
modprobe tun 2>/dev/null || true

if [ ! -f .env ]; then
    read -rp "Domain pointed to this server (empty = IP only): " DOMAIN
    PASSWORD="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)"
    echo
    echo "Connection logging records the destination domain (SNI) of each user's"
    echo "connection in the database, so you can see what sites a user accesses."
    echo "This is privacy-invasive; leave it off unless you need it and it is lawful"
    echo "and disclosed to your users. You can also toggle it later in the panel."
    read -rp "Enable connection (domain) logging? [y/N]: " LOGANS
    case "${LOGANS}" in [yY]*) CONNECTION_LOG=true ;; *) CONNECTION_LOG=false ;; esac
    cp .env.example .env
    sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" .env
    sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${PASSWORD}|" .env
    sed -i "s|^CONNECTION_LOG=.*|CONNECTION_LOG=${CONNECTION_LOG}|" .env
    echo "Generated admin password: ${PASSWORD}"
    echo "Connection logging: ${CONNECTION_LOG}"
fi

if [ "${BRPAN_SKIP_FIREWALL:-0}" != "1" ] && command -v ufw >/dev/null 2>&1; then
    echo "Opening ports in ufw..."
    ufw allow 22/tcp >/dev/null
    for rule in 80/tcp 443/tcp 443/udp 8443/tcp 8388/tcp 8388/udp 51820/udp 51821/udp 1194/udp; do
        ufw allow "$rule" >/dev/null
    done
    ufw route allow in on brpan-wg >/dev/null 2>&1 || true
    ufw route allow in on brpan-awg >/dev/null 2>&1 || true
    ufw route allow in on brpan-ovpn >/dev/null 2>&1 || true
    sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw
    ufw --force enable >/dev/null
    ufw reload >/dev/null
fi

mkdir -p data caddy
docker compose up -d --build

set -a
. ./.env
set +a
echo
echo "BRPAN is starting."
if [ -n "${DOMAIN:-}" ]; then
    echo "Panel: https://${DOMAIN}  (or https://${DOMAIN}:${CADDY_HTTPS_PORT:-8443})"
else
    echo "Panel: https://$(curl -fsS4 https://api.ipify.org || echo SERVER_IP):${CADDY_HTTPS_PORT:-8443}"
fi
echo "Login: ${ADMIN_USERNAME:-admin} / password from .env (ADMIN_PASSWORD)"
echo "Logs:  docker compose logs -f brpan"
