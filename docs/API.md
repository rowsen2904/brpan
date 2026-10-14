# API

Все запросы — JSON, авторизация заголовком `Authorization: Bearer <token>`.
Токен — JWT из `/api/auth/login` (живёт 7 дней) или постоянный API-токен из **Settings → API tokens**.

Базовый URL: `https://<домен>` (или `:8443`).

## Пользователи

### Создать

```http
POST /api/users
{
  "username": "client_42",
  "trafficLimit": 107374182400,
  "resetStrategy": "MONTH",
  "expireAt": 1798761600000,
  "deviceLimit": 3,
  "protocols": ["vless-reality", "vless-xhttp", "shadowsocks", "hysteria2", "amneziawg"],
  "telegramId": "123456789",
  "note": "paid till 2027-01-01"
}
```

| Поле | Тип | Описание |
|---|---|---|
| `username` | string | `[A-Za-z0-9_.@+-]`, уникальный |
| `status` | `ACTIVE` \| `DISABLED` | по умолчанию `ACTIVE` |
| `trafficLimit` | number, байты | `0` — без лимита |
| `resetStrategy` | `NO_RESET` \| `DAY` \| `WEEK` \| `MONTH` | сброс счётчика трафика |
| `expireAt` | number (ms) \| null | `null` — бессрочно |
| `deviceLimit` | number | `0` — без лимита |
| `protocols` | string[] | `vless-reality`, `vless-xhttp`, `trojan-ws`, `shadowsocks`, `hysteria2`, `wireguard`, `amneziawg`, `openvpn` |
| `telegramId`, `email`, `note` | string | произвольные |

Ответ — объект пользователя, в т.ч. `subscriptionUrl`.

### Остальное

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/users?search=&status=&offset=&limit=&sort=&order=` | Список. `status`: `ACTIVE`, `DISABLED`, `LIMITED`, `EXPIRED`, `ONLINE` |
| GET | `/api/users/:id` | Пользователь + ссылки (`subscription.url`, `subscription.happ`, `outline`, `wireguard`, …) + устройства + IP + трафик за 30 дней |
| PATCH | `/api/users/:id` | Частичное обновление, поля как при создании |
| DELETE | `/api/users/:id` | Удалить |
| POST | `/api/users/:id/reset` | Обнулить трафик |
| POST | `/api/users/:id/revoke` | Перевыпустить все ключи и URL подписки |
| POST | `/api/users/:id/enable` / `disable` | Включить / выключить |
| DELETE | `/api/users/:id/devices` | Сбросить все HWID-устройства |
| DELETE | `/api/users/:id/devices/:deviceId` | Удалить одно устройство |
| DELETE | `/api/users/:id/connections` | Очистить лог доменов пользователя |
| DELETE | `/api/system/connections` | Очистить логи доменов всех пользователей |
| POST | `/api/users/bulk` | `{ "ids": [1,2], "action": "enable\|disable\|delete\|reset\|revoke\|extend", "days": 30 }` |
| POST | `/api/users/bulk-create` | `{ "prefix": "user_", "count": 10, "template": { ...поля пользователя без username } }` |

Продление на 30 дней от текущей даты окончания:

```bash
curl -X POST https://vpn.example.com/api/users/bulk \
  -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"ids":[42],"action":"extend","days":30}'
```

## Прочее

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/dashboard` | Статистика для дашборда |
| GET / PATCH | `/api/settings` | Настройки (домен, подписка, лимиты, протоколы) |
| POST | `/api/settings/regenerate/:what` | `reality`, `wireguard`, `amneziawg`, `paths` |
| GET | `/api/system/cores` | Статусы и логи ядер |
| POST | `/api/system/:core/restart` | `xray`, `wireguard`, `amneziawg`, `openvpn`, `caddy` |

## Подписка (публично)

| Путь | Ответ |
|---|---|
| `/sub/:shortId` | Формат по User-Agent: base64 / Clash / sing-box / HTML-страница |
| `/sub/:shortId/base64`, `/plain`, `/clash`, `/singbox` | Принудительный формат |
| `/sub/:shortId/outline` | JSON динамического ключа Outline (`ssconf://`) |
| `/sub/:shortId/wireguard.conf`, `/amneziawg.conf` | Конфиги WireGuard / AmneziaWG |
| `/sub/:shortId/openvpn.ovpn` | Профиль OpenVPN |
| `/sub/:shortId/info` | JSON для страницы подписки |
