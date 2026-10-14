# Деплой BRPAN на сервер

## Требования

- VPS с Linux x86_64 или arm64: Ubuntu 22.04/24.04 или Debian 12 (ядро 5.6+).
- 1 vCPU / 1 GB RAM хватает на сотни пользователей.
- Публичный IPv4.
- Домен с A-записью на IP сервера (например `vpn.example.com`). **Без прокси Cloudflare** (серое облако) — Reality, Hysteria2, WireGuard, Shadowsocks должны подключаться к серверу напрямую.
- Свободные порты 80 и 443 (никакого nginx/apache на хосте).

Без домена панель тоже запустится (самоподписанный сертификат на IP), но не будут работать VLESS XHTTP, Trojan WS и `ssconf://` ключи Outline (Outline требует валидный HTTPS).

## Порты (фаервол)

| Порт | Протокол | Для чего | Обязателен |
|---|---|---|---|
| 22 | TCP | SSH | да |
| 80 | TCP | ACME (Let's Encrypt) и редирект на HTTPS | да, если есть домен |
| 443 | TCP | VLESS Reality; через fallback Reality — панель, подписки, XHTTP, Trojan WS | да |
| 443 | UDP | Hysteria2 | если включён Hysteria2 |
| 8443 | TCP | Caddy напрямую: панель, подписки, XHTTP, Trojan WS (если Reality выключен или занимает 443 с чужим SNI) | рекомендуется |
| 8388 | TCP + UDP | Shadowsocks / Outline | если включён |
| 51820 | UDP | WireGuard | если включён |
| 51821 | UDP | AmneziaWG | если включён |
| 1194 | UDP (или TCP) | OpenVPN | если включён (по умолчанию выключен) |

Внутренние порты, **открывать не нужно** (слушают только 127.0.0.1): 3000 (панель), 2019 (Caddy admin), 61000 (Xray API), 7505 (OpenVPN management), 20001/20002 (XHTTP/Trojan за Caddy).

Если меняете порт протокола в панели — откройте новый порт в фаерволе.

### ufw

```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow 8443/tcp
ufw allow 8388/tcp
ufw allow 8388/udp
ufw allow 51820/udp
ufw allow 51821/udp
ufw allow 1194/udp
sed -i 's/^DEFAULT_FORWARD_POLICY=.*/DEFAULT_FORWARD_POLICY="ACCEPT"/' /etc/default/ufw
ufw --force enable && ufw reload
```

`DEFAULT_FORWARD_POLICY="ACCEPT"` нужен для WireGuard/AmneziaWG/OpenVPN: их трафик маршрутизируется через ядро хоста (NAT).

### iptables / nftables без ufw

```bash
iptables -A INPUT -p tcp -m multiport --dports 22,80,443,8443,8388 -j ACCEPT
iptables -A INPUT -p udp -m multiport --dports 443,8388,51820,51821,1194 -j ACCEPT
```

### Фаервол провайдера

У Hetzner, AWS, Oracle, GCP и т.п. есть внешний firewall/security group — откройте в нём те же порты (особенно UDP).

## Установка

### Автоматически

```bash
apt update && apt install -y git curl
git clone <ваш-репозиторий> /opt/brpan
cd /opt/brpan
sudo ./install.sh
```

Скрипт:
1. ставит Docker, если его нет;
2. включает `net.ipv4.ip_forward`, BBR и увеличенные буферы (`/etc/sysctl.d/99-brpan.conf`);
3. спрашивает домен и создаёт `.env` со случайным паролем администратора;
4. открывает порты в `ufw` (если установлен; пропустить — `BRPAN_SKIP_FIREWALL=1`);
5. собирает и запускает контейнеры.

### Вручную

```bash
curl -fsSL https://get.docker.com | sh

cat >/etc/sysctl.d/99-brpan.conf <<'EOF'
net.ipv4.ip_forward = 1
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr
EOF
sysctl --system

cd /opt/brpan
cp .env.example .env
nano .env            # DOMAIN, ADMIN_PASSWORD
mkdir -p data caddy
docker compose up -d --build
docker compose logs -f brpan
```

Если `ADMIN_PASSWORD` пустой, пароль сгенерируется и будет выведен в `docker compose logs brpan` при первом запуске.

## Первый вход

- С доменом: `https://vpn.example.com` (порт 443 через Reality fallback) или `https://vpn.example.com:8443`.
- Без домена: `https://IP:8443` (самоподписанный сертификат, браузер предупредит).

Сертификат Let's Encrypt Caddy получает в течение ~1 минуты после старта (нужен открытый порт 80 и правильная A-запись). Hysteria2 автоматически переключается с самоподписанного сертификата на сертификат Caddy (проверка каждые 10 минут).

После входа:
1. **Settings** — смените пароль администратора, задайте название профиля, ссылку на поддержку, версию Happ crypto.
2. **Protocols** — включите/выключите нужные протоколы, поменяйте порты.
3. **Users → Create** — создайте пользователя, откройте его карточку: ссылка подписки, Happ crypt-ссылка, ключ Outline, `.conf` для WireGuard/AmneziaWG, `.ovpn`.

## Как устроен порт 443

По умолчанию Reality слушает `443/tcp` с `target = 127.0.0.1:8443` и `serverNames = [ваш домен]` («steal from yourself»):
- VPN-клиенты с ключом Reality получают прокси;
- все остальные (браузеры, DPI-пробы) прозрачно попадают в Caddy и видят настоящий сайт/панель с валидным сертификатом.

Поэтому подписки и XHTTP/Trojan работают на `https://домен` без порта. Если поставить в Reality чужой сайт (например `www.google.com:443`), панель и подписки будут на `:8443`.

## Обновление

```bash
cd /opt/brpan
git pull
docker compose up -d --build
```

Данные (`./data`: SQLite-база, ключи, PKI OpenVPN) и сертификаты (volume `caddy_data`) сохраняются.

## Бэкап

```bash
cd /opt/brpan
docker compose stop brpan
tar czf brpan-backup-$(date +%F).tgz data .env
docker compose start brpan
```

Восстановление — распаковать `data` и `.env` в каталог проекта и `docker compose up -d`.

## Включение OpenVPN

OpenVPN по умолчанию выключен (легко детектируется DPI). Включите в **Protocols → OpenVPN**, откройте `1194/udp` и разрешите пользователю протокол OpenVPN в его форме. Профиль `.ovpn` (с персональным сертификатом) скачивается из карточки пользователя или со страницы подписки. «Revoke keys» перевыпускает сертификат, старый профиль перестаёт пускать.

## Диагностика

```bash
docker compose ps
docker compose logs -f brpan          # панель + ошибки ядер
docker compose logs -f caddy          # сертификаты
docker exec brpan awg show            # WireGuard / AmneziaWG пиры
docker exec brpan xray version
ss -tulpn | grep -E ':(443|8443|8388|51820|51821|1194)\b'
```

В панели: **Cores & logs** — статус и логи Xray, WireGuard, AmneziaWG, OpenVPN, текущий Caddyfile и сгенерированный конфиг Xray.

Частые проблемы:

| Симптом | Причина |
|---|---|
| Caddy `not applied`, нет сертификата | Закрыт порт 80, неверная A-запись или домен за прокси Cloudflare |
| WireGuard/AWG `stopped`, в логах `UAPI socket` | Нет `/dev/net/tun` (`modprobe tun`) или контейнер без `NET_ADMIN` |
| WireGuard подключается, но нет интернета | Не включён `ip_forward` или `DEFAULT_FORWARD_POLICY="DROP"` в ufw |
| Hysteria2 не подключается | Закрыт `443/udp` у провайдера |
| Outline пишет про неверный ключ | Нет домена/валидного сертификата: `ssconf://` требует HTTPS |
| Happ показывает «Device limit reached» | Превышен лимит устройств: удалите старое устройство в карточке пользователя → Devices |

## Переменные окружения (.env)

| Переменная | По умолчанию | Описание |
|---|---|---|
| `DOMAIN` | — | Домен панели (используется при первом запуске, потом меняется в Settings) |
| `ADMIN_USERNAME` | `admin` | Логин администратора при первом запуске |
| `ADMIN_PASSWORD` | случайный | Пароль администратора при первом запуске |
| `PORT` | `3000` | Внутренний порт панели (127.0.0.1) |
| `CADDY_HTTPS_PORT` | `8443` | Порт Caddy |
| `STATS_INTERVAL` | `15` | Период сбора статистики, сек |
| `LOG_LEVEL` | `warn` | Уровень логов Fastify |
