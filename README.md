# BRPAN

Лёгкая панель управления VPN-сервисом на одном сервере. Идея и модель данных взяты у [Remnawave](https://github.com/remnawave) (пользователи, лимиты трафика, HWID-лимит устройств, подписки, Happ crypto-ссылки), но без разделения на panel/node, без PostgreSQL/Redis и очередей: один контейнер с панелью и ядрами + Caddy для TLS.

## Что умеет

- **Все протоколы на одном сервере одновременно**
  - VLESS + Reality (Vision) — Happ, v2RayTun, v2rayNG, Hiddify, Streisand, Clash Meta
  - VLESS + XHTTP через TLS (Caddy) — подходит для CDN
  - Trojan + WebSocket через TLS (Caddy)
  - Shadowsocks — **Outline** (динамические ключи `ssconf://`) и любые SS-клиенты
  - Hysteria2 (UDP/QUIC) — Happ, Hiddify, sing-box, NekoBox
  - WireGuard — официальный клиент, AmneziaVPN, Clash Meta
  - AmneziaWG — AmneziaVPN / AmneziaWG (обход блокировок WireGuard)
  - OpenVPN — OpenVPN Connect (сертификат на пользователя)
- **Одна ссылка подписки** на пользователя, формат выбирается по User-Agent:
  base64 (Happ, v2RayTun, v2rayNG, Streisand, Shadowrocket, Hiddify), Clash/Mihomo YAML, sing-box JSON, страница подписки для браузера.
  Каждому клиенту отдаются только поддерживаемые им протоколы (например, Happ получает VLESS/Trojan/Shadowsocks/Hysteria2, но не `wireguard://` — его Happ не умеет; WireGuard/AmneziaWG берутся как `.conf`).
- **Happ**: `happ://add/...` и зашифрованные `happ://crypt2|crypt3|crypt4/...`, заголовки `profile-title`, `subscription-userinfo`, `announce`, `support-url`.
- **Лимиты**: трафик (с ежедневным/еженедельным/ежемесячным сбросом), срок действия, лимит устройств:
  - HWID (`x-hwid` от Happ/v2RayTun/INCY) при получении подписки, как в Remnawave;
  - для OpenVPN — по числу одновременных сессий;
  - опционально — по числу уникальных IP для всех протоколов (временная блокировка).
- Пользователи отключаются в ядрах **сразу** при превышении лимита/окончании срока (Xray через gRPC API без перезапуска, WireGuard/AWG через `awg set`, OpenVPN через management `client-kill`).
- Дашборд: пользователи, онлайн, трафик по дням и по протоколам, топ пользователей, CPU/RAM/диск/сеть, статус ядер.
- Массовые операции, массовое создание, ревок ключей, устройства и IP пользователя, логи ядер, API-токены для ботов.

## Стек

| Часть | Технологии |
|---|---|
| Backend | Node.js 24, TypeScript, Fastify, встроенный `node:sqlite` |
| Frontend | React 19, Mantine 9, TanStack Query, Recharts |
| Ядра | Xray-core 26 (gRPC через `@remnawave/xtls-sdk`), amneziawg-go + awg tools, OpenVPN 2.6 |
| TLS | Caddy 2 (ACME, reverse proxy для XHTTP/WS) |

## Быстрый старт

```bash
git clone https://github.com/rowsen2904/brpan /opt/brpan && cd /opt/brpan
sudo ./install.sh
```

Обновление позже — `sudo ./update.sh` (тянет последний код с GitHub и пересобирает, сохраняя `.env` и базу).

Подробно — [docs/DEPLOY.md](docs/DEPLOY.md). API для ботов/биллинга — [docs/API.md](docs/API.md).

## Разработка

```bash
cd backend && npm i && DATA_DIR=./data XRAY_BIN=/path/to/xray CADDY_ENABLED=false PORT=3111 npm run dev
cd frontend && npm i && npm run dev
```

Vite проксирует `/api` и `/sub` на `127.0.0.1:3111`. WireGuard/AmneziaWG/OpenVPN запускаются только на Linux.

## Лицензия

AGPL-3.0 (как у Remnawave и `@remnawave/xtls-sdk`).
