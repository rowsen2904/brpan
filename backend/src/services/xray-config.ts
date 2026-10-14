import { config } from '../config.js';
import type { Protocol, Settings, UserRow } from '../types.js';
import { hasProtocol, isActive } from './users.js';

export interface TlsFiles {
    certFile: string;
    keyFile: string;
}

export function xrayClient(protocol: Protocol, user: UserRow, s: Settings): Record<string, unknown> | null {
    const email = String(user.id);
    switch (protocol) {
        case 'vless-reality':
            return { id: user.uuid, flow: 'xtls-rprx-vision', email };
        case 'vless-xhttp':
            return { id: user.uuid, email };
        case 'trojan-ws':
            return { password: user.trojan_password, email };
        case 'shadowsocks':
            return { password: user.ss_password, method: s.protocols.shadowsocks.method, email };
        case 'hysteria2':
            return { auth: user.uuid, email };
        default:
            return null;
    }
}

function clientsFor(protocol: Protocol, users: UserRow[], s: Settings) {
    return users
        .filter((u) => isActive(u) && hasProtocol(u, protocol))
        .map((u) => xrayClient(protocol, u, s))
        .filter(Boolean);
}

const sniffing = { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true };

export function buildXrayConfig(s: Settings, users: UserRow[], tls: TlsFiles | null) {
    const p = s.protocols;
    const inbounds: Record<string, unknown>[] = [
        {
            tag: 'api',
            listen: '127.0.0.1',
            port: config.xrayApiPort,
            protocol: 'dokodemo-door',
            settings: { address: '127.0.0.1' },
        },
    ];

    if (p['vless-reality'].enabled) {
        const r = p['vless-reality'];
        inbounds.push({
            tag: 'vless-reality',
            listen: '0.0.0.0',
            port: r.port,
            protocol: 'vless',
            settings: { clients: clientsFor('vless-reality', users, s), decryption: 'none' },
            streamSettings: {
                network: 'raw',
                security: 'reality',
                realitySettings: {
                    target: r.target,
                    serverNames: r.serverNames,
                    privateKey: r.privateKey,
                    shortIds: r.shortIds,
                },
            },
            sniffing,
        });
    }

    if (p['vless-xhttp'].enabled) {
        const x = p['vless-xhttp'];
        inbounds.push({
            tag: 'vless-xhttp',
            listen: '127.0.0.1',
            port: x.internalPort,
            protocol: 'vless',
            settings: { clients: clientsFor('vless-xhttp', users, s), decryption: 'none' },
            streamSettings: { network: 'xhttp', xhttpSettings: { path: x.path, mode: x.mode } },
            sniffing,
        });
    }

    if (p['trojan-ws'].enabled) {
        const t = p['trojan-ws'];
        inbounds.push({
            tag: 'trojan-ws',
            listen: '127.0.0.1',
            port: t.internalPort,
            protocol: 'trojan',
            settings: { clients: clientsFor('trojan-ws', users, s) },
            streamSettings: { network: 'ws', wsSettings: { path: t.path } },
            sniffing,
        });
    }

    if (p.shadowsocks.enabled) {
        inbounds.push({
            tag: 'shadowsocks',
            listen: '0.0.0.0',
            port: p.shadowsocks.port,
            protocol: 'shadowsocks',
            settings: { network: 'tcp,udp', clients: clientsFor('shadowsocks', users, s) },
            sniffing,
        });
    }

    if (p.hysteria2.enabled && tls) {
        const h = p.hysteria2;
        inbounds.push({
            tag: 'hysteria2',
            listen: '0.0.0.0',
            port: h.port,
            protocol: 'hysteria',
            settings: { version: 2, users: clientsFor('hysteria2', users, s) },
            streamSettings: {
                network: 'hysteria',
                hysteriaSettings: { version: 2 },
                security: 'tls',
                tlsSettings: {
                    alpn: ['h3'],
                    certificates: [{ certificateFile: tls.certFile, keyFile: tls.keyFile }],
                },
                ...(h.obfsPassword
                    ? { finalmask: { udp: [{ type: 'salamander', settings: { password: h.obfsPassword } }] } }
                    : {}),
            },
            sniffing,
        });
    }

    return {
        log: { loglevel: 'warning' },
        api: { tag: 'api', services: ['HandlerService', 'StatsService'] },
        stats: {},
        policy: {
            levels: { '0': { statsUserUplink: true, statsUserDownlink: true, statsUserOnline: true } },
            system: { statsInboundUplink: true, statsInboundDownlink: true },
        },
        inbounds,
        outbounds: [
            { tag: 'direct', protocol: 'freedom' },
            { tag: 'block', protocol: 'blackhole' },
        ],
        routing: {
            domainStrategy: 'IPIfNonMatch',
            rules: [
                { inboundTag: ['api'], outboundTag: 'api' },
                { ip: ['geoip:private'], outboundTag: 'block' },
                { domain: ['localhost'], outboundTag: 'block' },
                { protocol: ['bittorrent'], outboundTag: 'block' },
            ],
        },
    };
}
