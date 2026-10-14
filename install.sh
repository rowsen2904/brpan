#!/usr/bin/env bash
# BRPAN one-command installer: Docker, kernel tuning, firewall, TLS, all VPN cores.
set -euo pipefail

cd "$(dirname "$0")"

RED='\033[0;31m'; GRN='\033[0;32m'; YLW='\033[0;33m'; CYN='\033[0;36m'; NC='\033[0m'
info() { printf "${CYN}==>${NC} %s\n" "$1"; }
ok() { printf "${GRN}✓${NC} %s\n" "$1"; }
warn() { printf "${YLW}!${NC} %s\n" "$1"; }
die() { printf "${RED}✗ %s${NC}\n" "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root: sudo ./install.sh"
[ "$(uname -s)" = "Linux" ] || die "BRPAN runs on Linux servers only."

# ── 1. Docker ───────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
    info "Installing Docker..."
    curl -fsSL https://get.docker.com | sh >/dev/null
    systemctl enable --now docker >/dev/null 2>&1 || true
fi
docker compose version >/dev/null 2>&1 || die "docker compose plugin is missing. Install Docker Engine 20.10+."
ok "Docker $(docker --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"

# ── 2. Kernel tuning (BBR, forwarding, buffers, fast open) ───
info "Applying network tuning (BBR, fq, TCP fast open, buffers)..."
modprobe tun 2>/dev/null || true
modprobe wireguard 2>/dev/null || true
cat >/etc/sysctl.d/99-brpan.conf <<'EOF'
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
net.ipv4.tcp_fastopen = 3
net.ipv4.tcp_slow_start_after_idle = 0
net.ipv4.tcp_mtu_probing = 1
net.ipv4.tcp_notsent_lowat = 131072
net.ipv4.ip_local_port_range = 10000 65535
net.ipv4.tcp_keepalive_time = 600
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 5
net.netfilter.nf_conntrack_max = 262144
net.core.rmem_max = 67108864
net.core.wmem_max = 67108864
net.ipv4.tcp_rmem = 4096 87380 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864
net.core.netdev_max_backlog = 16384
net.core.somaxconn = 8192
net.ipv4.udp_rmem_min = 8192
net.ipv4.udp_wmem_min = 8192
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_max_syn_backlog = 8192
fs.file-max = 1048576
EOF
sysctl --system >/dev/null 2>&1 || warn "sysctl could not apply all keys (OK on some VPS)."
if [ "$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)" = "bbr" ]; then
    ok "BBR congestion control active"
else
    warn "BBR not available on this kernel; using $(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)."
fi

# ── 3. Configuration (.env) ─────────────────────────────────
PUBLIC_IP="$(curl -fsS4 --max-time 8 https://api.ipify.org 2>/dev/null || echo '')"

if [ ! -f .env ]; then
    echo
    info "Configuration"
    echo "A domain pointed at this server (A record) is strongly recommended:"
    echo "it enables Let's Encrypt TLS, VLESS-XHTTP, Trojan and Outline keys."
    read -rp "Domain (e.g. vpn.example.com, empty = IP only): " DOMAIN
    DOMAIN="$(echo "${DOMAIN}" | tr -d ' ' | sed 's#^https\?://##; s#/.*##')"

    if [ -n "${DOMAIN}" ] && [ -n "${PUBLIC_IP}" ]; then
        RESOLVED="$(getent ahostsv4 "${DOMAIN}" 2>/dev/null | awk '{print $1}' | head -1 || true)"
        if [ -z "${RESOLVED}" ]; then
            warn "${DOMAIN} does not resolve yet. Add an A record → ${PUBLIC_IP} before TLS can be issued."
        elif [ "${RESOLVED}" != "${PUBLIC_IP}" ]; then
            warn "${DOMAIN} → ${RESOLVED}, but this server is ${PUBLIC_IP}."
            warn "If ${DOMAIN} is proxied (Cloudflare orange cloud), turn it OFF (grey cloud)."
            read -rp "Continue anyway? [y/N]: " C; case "${C}" in [yY]*) ;; *) die "Fix DNS and re-run." ;; esac
        else
            ok "${DOMAIN} → ${PUBLIC_IP}"
        fi
    fi

    echo
    echo "OpenVPN is included but easier to detect by DPI than the other protocols."
    read -rp "Enable OpenVPN too? [y/N]: " OVPNANS
    case "${OVPNANS}" in [yY]*) OPENVPN_ENABLED=true ;; *) OPENVPN_ENABLED=false ;; esac

    echo
    echo "Connection logging stores the destination domain (SNI) of each user's"
    echo "connections in the database (privacy-invasive). Toggle later in the panel."
    read -rp "Enable domain logging now? [y/N]: " LOGANS
    case "${LOGANS}" in [yY]*) CONNECTION_LOG=true ;; *) CONNECTION_LOG=false ;; esac

    PASSWORD="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9')"
    cp .env.example .env
    sed -i "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" .env
    [ -z "${DOMAIN}" ] && [ -n "${PUBLIC_IP}" ] && sed -i "s|^#\?SERVER_ADDRESS=.*|SERVER_ADDRESS=${PUBLIC_IP}|" .env
    sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${PASSWORD}|" .env
    sed -i "s|^CONNECTION_LOG=.*|CONNECTION_LOG=${CONNECTION_LOG}|" .env
    sed -i "s|^#\?OPENVPN_ENABLED=.*|OPENVPN_ENABLED=${OPENVPN_ENABLED}|" .env
    ok "Wrote .env (admin password generated)"
else
    warn ".env already exists — keeping it. Delete it to reconfigure."
fi

set -a; . ./.env; set +a
DOMAIN="${DOMAIN:-}"
HTTPS_PORT="${CADDY_HTTPS_PORT:-8443}"

# ── 4. Firewall ─────────────────────────────────────────────
OVPN_PORT_RULE=""
[ "${OPENVPN_ENABLED:-false}" = "true" ] && OVPN_PORT_RULE="1194/udp"

if [ "${BRPAN_SKIP_FIREWALL:-0}" != "1" ]; then
    if command -v ufw >/dev/null 2>&1; then
        info "Opening ports in ufw..."
        for r in 22/tcp 80/tcp 443/tcp 443/udp "${HTTPS_PORT}/tcp" 8388/tcp 8388/udp 51820/udp 51821/udp ${OVPN_PORT_RULE}; do
            ufw allow "$r" >/dev/null 2>&1 || true
        done
        sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw 2>/dev/null || true
        ufw --force enable >/dev/null 2>&1 || true
        ufw reload >/dev/null 2>&1 || true
        ok "ufw rules applied"
    elif command -v firewall-cmd >/dev/null 2>&1; then
        info "Opening ports in firewalld..."
        for p in 22/tcp 80/tcp 443/tcp 443/udp "${HTTPS_PORT}/tcp" 8388/tcp 8388/udp 51820/udp 51821/udp ${OVPN_PORT_RULE}; do
            firewall-cmd --permanent --add-port="$p" >/dev/null 2>&1 || true
        done
        firewall-cmd --reload >/dev/null 2>&1 || true
        ok "firewalld rules applied"
    else
        warn "No ufw/firewalld found. If a firewall is active, open: 22,80,443(tcp+udp),${HTTPS_PORT},8388(tcp+udp),51820/udp,51821/udp${OVPN_PORT_RULE:+,1194/udp}"
    fi
    warn "Also open these ports in your provider's external firewall (Hetzner/AWS/Oracle…), UDP included."
fi

# ── 5. Build & start ────────────────────────────────────────
info "Building and starting containers (first build downloads cores, a few minutes)..."
mkdir -p data caddy
docker compose up -d --build
ok "Containers up"

# ── 6. Wait for TLS ─────────────────────────────────────────
PANEL_URL="https://${PUBLIC_IP:-SERVER_IP}:${HTTPS_PORT}"
if [ -n "${DOMAIN}" ]; then
    PANEL_URL="https://${DOMAIN}"
    printf "${CYN}==>${NC} Waiting for Let's Encrypt certificate for %s " "${DOMAIN}"
    for _ in $(seq 1 45); do
        if curl -fsS --max-time 4 "https://${DOMAIN}/api/settings" -o /dev/null 2>/dev/null \
           || curl -fsS --max-time 4 "https://${DOMAIN}:${HTTPS_PORT}/api/settings" -o /dev/null 2>/dev/null; then
            printf " ${GRN}done${NC}\n"; break
        fi
        printf "."; sleep 3
    done
    echo
fi

# ── 7. Summary ──────────────────────────────────────────────
echo
ok "BRPAN is ready."
echo   "──────────────────────────────────────────────"
printf "  Panel:    ${GRN}%s${NC}\n" "${PANEL_URL}"
[ -n "${DOMAIN}" ] && printf "  Fallback: https://%s:%s\n" "${DOMAIN}" "${HTTPS_PORT}"
printf "  Login:    %s\n" "${ADMIN_USERNAME:-admin}"
printf "  Password: ${GRN}%s${NC}\n" "${ADMIN_PASSWORD}"
echo   "──────────────────────────────────────────────"
echo   "  Protocols live: VLESS Reality, VLESS XHTTP, Trojan WS,"
echo   "  Shadowsocks/Outline, Hysteria2, WireGuard, AmneziaWG${OPENVPN_ENABLED:+, OpenVPN}"
echo   "  Create users in the panel; each gets one subscription link for all apps."
echo   "  Logs: docker compose logs -f brpan"
[ -z "${DOMAIN}" ] && warn "No domain: XHTTP/Trojan/Outline are off and TLS is self-signed. Set a domain in Settings for the full set."
