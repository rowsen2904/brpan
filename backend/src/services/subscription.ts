import { createHappCryptoLink } from '@kastov/cryptohapp';

import { get, run } from '../db.js';
import type { Protocol, Settings, UserRow } from '../types.js';
import { mihomoConfig, singboxConfig } from './formats.js';
import { availableProtocols, outlineKey, PROTOCOL_LABELS, shareLink, type TlsInfo } from './links.js';
import { getSettings, publicBaseUrl } from './settings.js';
import { isActive } from './users.js';
import { amneziawg, wireguard } from './wireguard.js';
import { xray } from './xray.js';

export type SubFormat = 'base64' | 'plain' | 'clash' | 'singbox' | 'html';

const HWID_RE = /^[a-zA-Z0-9=-]{10,64}$/;

// Happ supports VLESS, VMess, Trojan, Shadowsocks, Socks, Hysteria2 only.
const NO_WIREGUARD_CLIENTS = /^Happ\//i;

export interface SubRequest {
    userAgent: string;
    accept: string;
    headers: Record<string, string | string[] | undefined>;
}

export interface SubResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
}

export function detectFormat(ua: string, accept: string): SubFormat {
    if (/clash|mihomo|stash|flclash|koala|prizrak|verge|nyanpasu|clashx/i.test(ua)) return 'clash';
    if (/^(sing-box|SFA|SFI|SFM|SFT)/i.test(ua)) return 'singbox';
    if (/mozilla|chrome|safari|firefox|edge|opera/i.test(ua) && accept.includes('text/html')) return 'html';
    return 'base64';
}

export function subscriptionUrl(user: UserRow, s = getSettings()) {
    return `${publicBaseUrl(s)}/sub/${user.short_id}`;
}

export function happCryptoLink(url: string, s = getSettings()): string | null {
    const v = s.subscription.happCrypto;
    if (v === 'none') return null;
    const res = createHappCryptoLink(url, v, true);
    return typeof res === 'string' ? res : null;
}

export function tlsInfo(): TlsInfo {
    return xray.certInfo();
}

export function hy2Available() {
    return xray.tlsFiles() !== null;
}

export function userLinks(user: UserRow, s = getSettings()) {
    const tls = tlsInfo();
    const protocols = availableProtocols(user, s, hy2Available());
    return protocols.map((protocol) => ({
        protocol,
        label: PROTOCOL_LABELS[protocol],
        link: shareLink(protocol, user, s, tls),
    }));
}

export function userSubscriptionInfo(user: UserRow) {
    const s = getSettings();
    const url = subscriptionUrl(user, s);
    const base = publicBaseUrl(s);
    const protocols = availableProtocols(user, s, hy2Available());
    const host = base.replace(/^https:\/\//, '');
    return {
        url,
        happ: happCryptoLink(url, s),
        happPlain: `happ://add/${url}`,
        outline: protocols.includes('shadowsocks') ? `ssconf://${host}/sub/${user.short_id}/outline#${encodeURIComponent(s.subscription.profileTitle)}` : null,
        wireguard: protocols.includes('wireguard') ? `${url}/wireguard.conf` : null,
        amneziawg: protocols.includes('amneziawg') ? `${url}/amneziawg.conf` : null,
        openvpn: protocols.includes('openvpn') ? `${url}/openvpn.ovpn` : null,
        clash: `${url}/clash`,
        singbox: `${url}/singbox`,
        links: userLinks(user, s),
    };
}

function noticeLink(message: string) {
    return `vless://00000000-0000-0000-0000-000000000000@127.0.0.1:1?type=tcp&security=none&encryption=none#${encodeURIComponent(message)}`;
}

function inactiveMessage(user: UserRow): string {
    if (user.blocked_until && user.blocked_until > Date.now()) return '⚠️ Too many devices, try later';
    switch (user.status) {
        case 'EXPIRED':
            return '⛔ Subscription expired';
        case 'LIMITED':
            return '⛔ Traffic limit reached';
        case 'DISABLED':
            return '⛔ Subscription disabled';
        default:
            return '⛔ Unavailable';
    }
}

function header(headers: SubRequest['headers'], name: string): string | undefined {
    const v = headers[name];
    const value = Array.isArray(v) ? v[0] : v;
    return value ? String(value).slice(0, 255) : undefined;
}

type HwidResult = 'ok' | 'limit' | 'required';

export function checkHwid(user: UserRow, req: SubRequest, s: Settings): HwidResult {
    const hwid = header(req.headers, 'x-hwid');
    if (!hwid || !HWID_RE.test(hwid)) {
        return user.device_limit > 0 && s.subscription.hwidRequired ? 'required' : 'ok';
    }
    const now = Date.now();
    const existing = get<{ id: number }>('SELECT id FROM devices WHERE user_id = ? AND hwid = ?', user.id, hwid);
    const meta = [
        header(req.headers, 'x-device-os') ?? null,
        header(req.headers, 'x-ver-os') ?? null,
        header(req.headers, 'x-device-model') ?? null,
        req.userAgent.slice(0, 255) || null,
    ];
    if (existing) {
        run('UPDATE devices SET platform = ?, os_version = ?, model = ?, user_agent = ?, updated_at = ? WHERE id = ?', ...meta, now, existing.id);
        return 'ok';
    }
    if (user.device_limit > 0) {
        const count = get<{ c: number }>('SELECT COUNT(*) AS c FROM devices WHERE user_id = ?', user.id)!.c;
        if (count >= user.device_limit) return 'limit';
    }
    run(
        'INSERT INTO devices (user_id, hwid, platform, os_version, model, user_agent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        user.id,
        hwid,
        ...meta,
        now,
        now,
    );
    return 'ok';
}

function b64(value: string) {
    return `base64:${Buffer.from(value).toString('base64')}`;
}

export function subscriptionHeaders(user: UserRow, s: Settings): Record<string, string> {
    const h: Record<string, string> = {
        'profile-title': b64(s.subscription.profileTitle),
        'profile-update-interval': String(s.subscription.updateIntervalHours),
        'subscription-userinfo': `upload=0; download=${user.traffic_used}; total=${user.traffic_limit}; expire=${user.expire_at ? Math.floor(user.expire_at / 1000) : 0}`,
        'profile-web-page-url': subscriptionUrl(user, s),
        'content-disposition': `attachment; filename="${encodeURIComponent(s.subscription.profileTitle)}"`,
        'cache-control': 'no-store',
    };
    if (s.subscription.supportUrl) h['support-url'] = s.subscription.supportUrl;
    if (s.subscription.announce) h.announce = b64(s.subscription.announce);
    return h;
}

export function buildSubscription(user: UserRow, format: Exclude<SubFormat, 'html'>, req: SubRequest): SubResponse {
    const s = getSettings();
    const headers = subscriptionHeaders(user, s);
    run('UPDATE users SET sub_updated_at = ?, sub_user_agent = ? WHERE id = ?', Date.now(), req.userAgent.slice(0, 255), user.id);

    let notice: string | null = null;
    if (!isActive(user)) notice = inactiveMessage(user);
    else {
        const hwid = checkHwid(user, req, s);
        if (hwid === 'limit') notice = '⚠️ Device limit reached';
        if (hwid === 'required') notice = '⚠️ Unsupported client: use Happ / v2RayTun';
    }

    const tls = tlsInfo();
    const protocols: Protocol[] = notice ? [] : availableProtocols(user, s, hy2Available()).filter((p) => p !== 'openvpn');
    const noWireguard = NO_WIREGUARD_CLIENTS.test(req.userAgent);
    const uriProtocols = protocols.filter((p) => p !== 'amneziawg' && !(noWireguard && p === 'wireguard'));

    if (notice && !s.subscription.showDisabledNotice) {
        return { status: 200, headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' }, body: '' };
    }

    switch (format) {
        case 'clash': {
            const extra = notice ? [{ name: notice, type: 'ss', server: '127.0.0.1', port: 1, cipher: 'chacha20-ietf-poly1305', password: 'none' }] : [];
            return {
                status: 200,
                headers: { ...headers, 'content-type': 'text/yaml; charset=utf-8' },
                body: mihomoConfig(protocols, user, s, tls, extra),
            };
        }
        case 'singbox': {
            const extra = notice
                ? [{ type: 'shadowsocks', tag: notice, server: '127.0.0.1', server_port: 1, method: 'chacha20-ietf-poly1305', password: 'none' }]
                : [];
            return {
                status: 200,
                headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
                body: singboxConfig(uriProtocols, user, s, tls, extra),
            };
        }
        default: {
            const links = notice
                ? [noticeLink(notice)]
                : uriProtocols.map((p) => shareLink(p, user, s, tls)).filter((l): l is string => !!l);
            const text = links.join('\n');
            return {
                status: 200,
                headers: { ...headers, 'content-type': 'text/plain; charset=utf-8' },
                body: format === 'plain' ? text : Buffer.from(text).toString('base64'),
            };
        }
    }
}

export function outlineResponse(user: UserRow): SubResponse {
    const s = getSettings();
    if (!isActive(user) || !availableProtocols(user, s, hy2Available()).includes('shadowsocks')) {
        return { status: 403, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: { message: inactiveMessage(user) } }) };
    }
    return { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(outlineKey(user, s)) };
}

export function wireguardResponse(user: UserRow, kind: 'wireguard' | 'amneziawg'): SubResponse {
    const s = getSettings();
    if (!isActive(user) || !availableProtocols(user, s, hy2Available()).includes(kind)) {
        return { status: 403, headers: { 'content-type': 'text/plain' }, body: inactiveMessage(user) };
    }
    return {
        status: 200,
        headers: {
            'content-type': 'text/plain; charset=utf-8',
            'content-disposition': `attachment; filename="${kind === 'amneziawg' ? 'awg' : 'wg'}-${user.username.replace(/[^a-zA-Z0-9_-]/g, '_')}.conf"`,
        },
        body: (kind === 'amneziawg' ? amneziawg : wireguard).clientConfig(user),
    };
}

export function publicInfo(user: UserRow) {
    const s = getSettings();
    const info = userSubscriptionInfo(user);
    const active = isActive(user);
    return {
        username: user.username,
        status: user.status,
        active,
        message: active ? null : inactiveMessage(user),
        trafficUsed: user.traffic_used,
        trafficLimit: user.traffic_limit,
        expireAt: user.expire_at,
        deviceLimit: user.device_limit,
        profileTitle: s.subscription.profileTitle,
        supportUrl: s.subscription.supportUrl,
        announce: s.subscription.announce,
        ...info,
        links: active ? info.links : [],
    };
}
