export const PROTOCOLS = ['vless-reality', 'vless-xhttp', 'trojan-ws', 'shadowsocks', 'hysteria2', 'wireguard', 'amneziawg', 'openvpn'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export const PROTOCOL_META: Record<Protocol, { label: string; color: string; clients: string }> = {
    'vless-reality': { label: 'VLESS Reality', color: 'cyan', clients: 'Happ, v2RayTun, v2rayNG, Hiddify, Streisand, Clash' },
    'vless-xhttp': { label: 'VLESS XHTTP', color: 'teal', clients: 'Happ, v2RayTun, v2rayNG, v2rayN, Clash Meta' },
    'trojan-ws': { label: 'Trojan WS', color: 'grape', clients: 'Happ, v2rayNG, Hiddify, sing-box, Clash, Shadowrocket' },
    shadowsocks: { label: 'Shadowsocks', color: 'orange', clients: 'Outline, Happ, v2rayNG, Shadowrocket, Clash' },
    hysteria2: { label: 'Hysteria2', color: 'pink', clients: 'Happ, Hiddify, sing-box, NekoBox, Clash Meta' },
    wireguard: { label: 'WireGuard', color: 'red', clients: 'WireGuard, AmneziaVPN, Hiddify, Clash Meta' },
    amneziawg: { label: 'AmneziaWG', color: 'violet', clients: 'AmneziaVPN, AmneziaWG, Clash Meta' },
    openvpn: { label: 'OpenVPN', color: 'yellow', clients: 'OpenVPN Connect, Tunnelblick, OpenVPN GUI' },
};

export type UserStatus = 'ACTIVE' | 'DISABLED' | 'LIMITED' | 'EXPIRED';
export type ResetStrategy = 'NO_RESET' | 'DAY' | 'WEEK' | 'MONTH';

export interface User {
    id: number;
    username: string;
    uuid: string;
    shortId: string;
    status: UserStatus;
    protocols: Protocol[];
    trafficLimit: number;
    trafficUsed: number;
    lifetimeUsed: number;
    resetStrategy: ResetStrategy;
    lastResetAt: number | null;
    expireAt: number | null;
    deviceLimit: number;
    note: string;
    telegramId: string | null;
    email: string | null;
    onlineAt: number | null;
    subUpdatedAt: number | null;
    subUserAgent: string | null;
    blockedUntil: number | null;
    wgIp: string;
    subscriptionUrl: string;
    createdAt: number;
    updatedAt: number;
}

export interface SubscriptionInfo {
    url: string;
    happ: string | null;
    happPlain: string;
    outline: string | null;
    wireguard: string | null;
    amneziawg: string | null;
    openvpn: string | null;
    clash: string;
    singbox: string;
    links: { protocol: Protocol; label: string; link: string | null }[];
}

export interface Device {
    id: number;
    hwid: string;
    platform: string | null;
    os_version: string | null;
    model: string | null;
    user_agent: string | null;
    created_at: number;
    updated_at: number;
}

export interface UsagePoint {
    date: string;
    up: number;
    down: number;
}

export interface Connection {
    host: string;
    protocol: string;
    hits: number;
    first_seen: number;
    last_seen: number;
}

export interface UserDetails {
    user: User;
    subscription: SubscriptionInfo;
    devices: Device[];
    ips: { ip: string; protocol: string; last_seen: number }[];
    usage: UsagePoint[];
    connectionLog: boolean;
    connections: Connection[];
}

export interface Settings {
    domain: string;
    serverAddress: string;
    remarkPrefix: string;
    publicBaseUrl: string;
    subscription: {
        profileTitle: string;
        updateIntervalHours: number;
        supportUrl: string;
        announce: string;
        happCrypto: 'none' | 'v2' | 'v3' | 'v4';
        hwidRequired: boolean;
        showDisabledNotice: boolean;
    };
    limits: { enforceIpLimit: boolean; ipWindowSec: number; blockMinutes: number };
    logging: { connectionLog: boolean; retentionDays: number };
    protocols: {
        'vless-reality': { enabled: boolean; port: number; target: string; serverNames: string[]; privateKey: string; publicKey: string; shortIds: string[]; fingerprint: string };
        'vless-xhttp': { enabled: boolean; path: string; internalPort: number; mode: string };
        'trojan-ws': { enabled: boolean; path: string; internalPort: number };
        shadowsocks: { enabled: boolean; port: number; method: string; prefix: string };
        hysteria2: { enabled: boolean; port: number; obfsPassword: string };
        wireguard: { enabled: boolean; port: number; privateKey: string; publicKey: string; subnet: string; mtu: number; dns: string };
        amneziawg: {
            enabled: boolean;
            port: number;
            privateKey: string;
            publicKey: string;
            subnet: string;
            mtu: number;
            dns: string;
            jc: number;
            jmin: number;
            jmax: number;
            s1: number;
            s2: number;
            h1: number;
            h2: number;
            h3: number;
            h4: number;
        };
        openvpn: { enabled: boolean; port: number; proto: 'udp' | 'tcp'; subnet: string; dns: string };
    };
}
