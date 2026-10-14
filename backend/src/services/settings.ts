import { config } from '../config.js';
import { get, run } from '../db.js';
import { randomHex, randomString, realityKeyPair, realityPublicKey, wgKeyPair } from '../lib/crypto.js';
import type { Settings } from '../types.js';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function defaults(): Settings {
    const domain = config.domain;
    const reality = realityKeyPair();
    const wg = wgKeyPair();
    const awg = wgKeyPair();
    const rnd = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
    const s1 = rnd(15, 150);
    let s2 = rnd(15, 150);
    if (s1 + 56 === s2) s2++;
    const headers = new Set<number>();
    while (headers.size < 4) headers.add(rnd(5, 2_147_483_647));
    const [h1, h2, h3, h4] = [...headers];
    return {
        domain,
        serverAddress: config.serverAddress || domain,
        remarkPrefix: 'BRPAN',
        country: '',
        mainProtocol: 'vless-reality',
        subscription: {
            profileTitle: 'BRPAN VPN',
            updateIntervalHours: 12,
            supportUrl: '',
            announce: '',
            happCrypto: 'v4',
            hwidRequired: false,
            showDisabledNotice: true,
        },
        limits: {
            enforceIpLimit: false,
            ipWindowSec: 60,
            blockMinutes: 5,
        },
        logging: {
            connectionLog: config.connectionLogDefault,
            retentionDays: 7,
        },
        protocols: {
            'vless-reality': {
                enabled: true,
                port: 443,
                target: domain ? `127.0.0.1:${config.caddyHttpsPort}` : 'www.google.com:443',
                serverNames: [domain || 'www.google.com'],
                privateKey: reality.privateKey,
                publicKey: reality.publicKey,
                shortIds: [randomHex(4)],
                fingerprint: 'chrome',
            },
            'vless-xhttp': {
                enabled: true,
                path: `/${randomString(12).toLowerCase()}`,
                internalPort: 20001,
                mode: 'auto',
            },
            'trojan-ws': {
                enabled: true,
                path: `/${randomString(12).toLowerCase()}`,
                internalPort: 20002,
            },
            shadowsocks: {
                enabled: true,
                port: 8388,
                method: 'chacha20-ietf-poly1305',
                prefix: '',
            },
            hysteria2: {
                enabled: true,
                port: 443,
                obfsPassword: '',
            },
            wireguard: {
                enabled: true,
                port: 51820,
                privateKey: wg.privateKey,
                publicKey: wg.publicKey,
                subnet: '10.66.0.0/16',
                mtu: 1420,
                dns: '1.1.1.1, 1.0.0.1',
            },
            amneziawg: {
                enabled: true,
                port: 51821,
                privateKey: awg.privateKey,
                publicKey: awg.publicKey,
                subnet: '10.68.0.0/16',
                mtu: 1280,
                dns: '1.1.1.1, 1.0.0.1',
                jc: 4,
                jmin: 40,
                jmax: 70,
                s1,
                s2,
                h1,
                h2,
                h3,
                h4,
            },
            openvpn: {
                enabled: config.openvpnDefault,
                port: 1194,
                proto: 'udp',
                subnet: '10.67.0.0/16',
                dns: '1.1.1.1',
            },
        },
    };
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function merge<T>(base: T, patch: unknown): T {
    if (!isObject(base) || !isObject(patch)) return (patch === undefined ? base : patch) as T;
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        out[k] = k in out ? merge(out[k], v) : v;
    }
    return out as T;
}

let cache: Settings | null = null;

export function getSettings(): Settings {
    if (cache) return cache;
    const row = get<{ value: string }>("SELECT value FROM settings WHERE key = 'settings'");
    const base = defaults();
    cache = row ? merge(base, JSON.parse(row.value)) : base;
    if (!cache.domain && config.domain) {
        cache.domain = config.domain;
        cache.serverAddress ||= config.domain;
    }
    if (!cache.serverAddress && config.serverAddress) cache.serverAddress = config.serverAddress;
    persist(cache);
    return cache;
}

function persist(settings: Settings) {
    run(
        "INSERT INTO settings (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        JSON.stringify(settings),
    );
}

export function updateSettings(patch: DeepPartial<Settings>): Settings {
    const prev = getSettings();
    const next = merge(prev, patch);
    const reality = next.protocols['vless-reality'];
    if (patch.domain !== undefined && patch.domain !== prev.domain && !patch.protocols?.['vless-reality']?.serverNames) {
        const names = reality.serverNames.filter((n) => n !== prev.domain);
        if (next.domain && reality.target === `127.0.0.1:${config.caddyHttpsPort}`) names.unshift(next.domain);
        reality.serverNames = names.length ? names : [next.domain || 'www.google.com'];
        if (!next.serverAddress || next.serverAddress === prev.domain) next.serverAddress = next.domain;
    }
    if (patch.protocols?.['vless-reality']?.privateKey) {
        reality.publicKey = realityPublicKeySafe(reality.privateKey) ?? reality.publicKey;
    }
    cache = next;
    persist(next);
    return next;
}

function realityPublicKeySafe(privateKey: string): string | null {
    try {
        return realityPublicKey(privateKey);
    } catch {
        return null;
    }
}

export function getSecret(key: string, factory: () => string): string {
    const row = get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    if (row) return JSON.parse(row.value);
    const value = factory();
    run('INSERT INTO settings (key, value) VALUES (?, ?)', key, JSON.stringify(value));
    return value;
}

export function publicHttpsPort(s = getSettings()): number {
    const r = s.protocols['vless-reality'];
    const selfSteal =
        r.enabled &&
        r.port === 443 &&
        r.target === `127.0.0.1:${config.caddyHttpsPort}` &&
        r.serverNames.includes(s.domain);
    return selfSteal ? 443 : config.caddyHttpsPort;
}

export function publicBaseUrl(s = getSettings()): string {
    const port = publicHttpsPort(s);
    const host = s.domain || s.serverAddress || 'localhost';
    return port === 443 ? `https://${host}` : `https://${host}:${port}`;
}
