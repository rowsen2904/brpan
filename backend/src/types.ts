export const PROTOCOLS = [
    'vless-reality',
    'vless-xhttp',
    'trojan-ws',
    'shadowsocks',
    'hysteria2',
    'wireguard',
    'amneziawg',
    'openvpn',
] as const;

export type Protocol = (typeof PROTOCOLS)[number];

export const XRAY_PROTOCOLS: Protocol[] = [
    'vless-reality',
    'vless-xhttp',
    'trojan-ws',
    'shadowsocks',
    'hysteria2',
];

export const USER_STATUSES = ['ACTIVE', 'DISABLED', 'LIMITED', 'EXPIRED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const RESET_STRATEGIES = ['NO_RESET', 'DAY', 'WEEK', 'MONTH'] as const;
export type ResetStrategy = (typeof RESET_STRATEGIES)[number];

export interface UserRow {
    id: number;
    username: string;
    uuid: string;
    short_id: string;
    status: UserStatus;
    trojan_password: string;
    ss_password: string;
    wg_private_key: string;
    wg_public_key: string;
    wg_index: number;
    ovpn_serial: string | null;
    protocols: string;
    traffic_limit: number;
    traffic_used: number;
    lifetime_used: number;
    reset_strategy: ResetStrategy;
    last_reset_at: number | null;
    expire_at: number | null;
    device_limit: number;
    note: string;
    telegram_id: string | null;
    email: string | null;
    online_at: number | null;
    sub_updated_at: number | null;
    sub_user_agent: string | null;
    blocked_until: number | null;
    created_at: number;
    updated_at: number;
}

export interface ProtocolSettings {
    'vless-reality': {
        enabled: boolean;
        port: number;
        target: string;
        serverNames: string[];
        privateKey: string;
        publicKey: string;
        shortIds: string[];
        fingerprint: string;
    };
    'vless-xhttp': {
        enabled: boolean;
        path: string;
        internalPort: number;
        mode: string;
    };
    'trojan-ws': {
        enabled: boolean;
        path: string;
        internalPort: number;
    };
    shadowsocks: {
        enabled: boolean;
        port: number;
        method: 'chacha20-ietf-poly1305' | 'aes-256-gcm' | 'aes-128-gcm';
        prefix: string;
    };
    hysteria2: {
        enabled: boolean;
        port: number;
        obfsPassword: string;
    };
    wireguard: {
        enabled: boolean;
        port: number;
        privateKey: string;
        publicKey: string;
        subnet: string;
        mtu: number;
        dns: string;
    };
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
    openvpn: {
        enabled: boolean;
        port: number;
        proto: 'udp' | 'tcp';
        subnet: string;
        dns: string;
    };
}

export interface Settings {
    domain: string;
    serverAddress: string;
    remarkPrefix: string;
    subscription: {
        profileTitle: string;
        updateIntervalHours: number;
        supportUrl: string;
        announce: string;
        happCrypto: 'none' | 'v2' | 'v3' | 'v4';
        hwidRequired: boolean;
        showDisabledNotice: boolean;
    };
    limits: {
        enforceIpLimit: boolean;
        ipWindowSec: number;
        blockMinutes: number;
    };
    logging: {
        connectionLog: boolean;
        retentionDays: number;
    };
    protocols: ProtocolSettings;
}
