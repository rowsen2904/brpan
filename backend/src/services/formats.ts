import YAML from 'yaml';

import { wgClientIp } from '../lib/net.js';
import type { Protocol, Settings, UserRow } from '../types.js';
import { remark, serverAddress, type TlsInfo } from './links.js';
import { publicHttpsPort } from './settings.js';

type Obj = Record<string, unknown>;

function mihomoProxy(protocol: Protocol, user: UserRow, s: Settings, tls: TlsInfo): Obj | null {
    const p = s.protocols;
    const name = remark(s, protocol);
    const server = serverAddress(s);
    switch (protocol) {
        case 'vless-reality': {
            const r = p['vless-reality'];
            return {
                name,
                type: 'vless',
                server,
                port: r.port,
                uuid: user.uuid,
                network: 'tcp',
                udp: true,
                tls: true,
                flow: 'xtls-rprx-vision',
                servername: r.serverNames[0],
                'client-fingerprint': r.fingerprint,
                'reality-opts': { 'public-key': r.publicKey, 'short-id': r.shortIds[0] ?? '' },
            };
        }
        case 'vless-xhttp': {
            const x = p['vless-xhttp'];
            return {
                name,
                type: 'vless',
                server: s.domain,
                port: publicHttpsPort(s),
                uuid: user.uuid,
                network: 'xhttp',
                udp: true,
                tls: true,
                servername: s.domain,
                'client-fingerprint': 'chrome',
                alpn: ['h2', 'http/1.1'],
                'xhttp-opts': { path: x.path, host: s.domain, mode: x.mode },
            };
        }
        case 'trojan-ws': {
            const t = p['trojan-ws'];
            return {
                name,
                type: 'trojan',
                server: s.domain,
                port: publicHttpsPort(s),
                password: user.trojan_password,
                network: 'ws',
                udp: true,
                sni: s.domain,
                'client-fingerprint': 'chrome',
                alpn: ['http/1.1'],
                'ws-opts': { path: t.path, headers: { Host: s.domain } },
            };
        }
        case 'shadowsocks':
            return {
                name,
                type: 'ss',
                server,
                port: p.shadowsocks.port,
                cipher: p.shadowsocks.method,
                password: user.ss_password,
                udp: true,
            };
        case 'hysteria2': {
            const h = p.hysteria2;
            return {
                name,
                type: 'hysteria2',
                server,
                port: h.port,
                password: user.uuid,
                sni: s.domain || 'www.bing.com',
                alpn: ['h3'],
                ...(tls.selfSigned ? { 'skip-cert-verify': true, ...(tls.pinSha256 ? { fingerprint: tls.pinSha256 } : {}) } : {}),
                ...(h.obfsPassword ? { obfs: 'salamander', 'obfs-password': h.obfsPassword } : {}),
            };
        }
        case 'wireguard': {
            const w = p.wireguard;
            return {
                name,
                type: 'wireguard',
                server,
                port: w.port,
                ip: wgClientIp(w.subnet, user.wg_index),
                'private-key': user.wg_private_key,
                'public-key': w.publicKey,
                'allowed-ips': ['0.0.0.0/0'],
                mtu: w.mtu,
                udp: true,
            };
        }
        case 'amneziawg': {
            const a = p.amneziawg;
            return {
                name,
                type: 'wireguard',
                server,
                port: a.port,
                ip: wgClientIp(a.subnet, user.wg_index),
                'private-key': user.wg_private_key,
                'public-key': a.publicKey,
                'allowed-ips': ['0.0.0.0/0'],
                mtu: a.mtu,
                udp: true,
                'amnezia-wg-option': { jc: a.jc, jmin: a.jmin, jmax: a.jmax, s1: a.s1, s2: a.s2, h1: a.h1, h2: a.h2, h3: a.h3, h4: a.h4 },
            };
        }
        default:
            return null;
    }
}

export function mihomoConfig(protocols: Protocol[], user: UserRow, s: Settings, tls: TlsInfo, extra: Obj[] = []): string {
    const proxies = [...protocols.map((p) => mihomoProxy(p, user, s, tls)).filter((p): p is Obj => p !== null), ...extra];
    const names = proxies.map((p) => String(p.name));
    const group = s.subscription.profileTitle || 'PROXY';
    const doc = {
        'mixed-port': 7890,
        'allow-lan': false,
        mode: 'rule',
        'log-level': 'info',
        ipv6: false,
        'unified-delay': true,
        dns: {
            enable: true,
            ipv6: false,
            'enhanced-mode': 'fake-ip',
            'fake-ip-range': '198.18.0.1/16',
            'default-nameserver': ['1.1.1.1', '8.8.8.8'],
            nameserver: ['https://1.1.1.1/dns-query', 'https://dns.google/dns-query'],
        },
        proxies,
        'proxy-groups': [
            { name: group, type: 'select', proxies: names.length > 1 ? ['Auto', ...names] : names },
            ...(names.length > 1
                ? [{ name: 'Auto', type: 'url-test', url: 'https://www.gstatic.com/generate_204', interval: 300, tolerance: 50, proxies: names }]
                : []),
        ],
        rules: ['GEOIP,private,DIRECT,no-resolve', `MATCH,${group}`],
    };
    return YAML.stringify(doc);
}

function singboxOutbound(protocol: Protocol, user: UserRow, s: Settings, tls: TlsInfo): { outbound?: Obj; endpoint?: Obj } | null {
    const p = s.protocols;
    const tag = remark(s, protocol);
    const server = serverAddress(s);
    switch (protocol) {
        case 'vless-reality': {
            const r = p['vless-reality'];
            return {
                outbound: {
                    type: 'vless',
                    tag,
                    server,
                    server_port: r.port,
                    uuid: user.uuid,
                    flow: 'xtls-rprx-vision',
                    tls: {
                        enabled: true,
                        server_name: r.serverNames[0],
                        utls: { enabled: true, fingerprint: r.fingerprint },
                        reality: { enabled: true, public_key: r.publicKey, short_id: r.shortIds[0] ?? '' },
                    },
                },
            };
        }
        case 'trojan-ws': {
            const t = p['trojan-ws'];
            return {
                outbound: {
                    type: 'trojan',
                    tag,
                    server: s.domain,
                    server_port: publicHttpsPort(s),
                    password: user.trojan_password,
                    tls: { enabled: true, server_name: s.domain, utls: { enabled: true, fingerprint: 'chrome' } },
                    transport: { type: 'ws', path: t.path, headers: { Host: s.domain } },
                },
            };
        }
        case 'shadowsocks':
            return {
                outbound: {
                    type: 'shadowsocks',
                    tag,
                    server,
                    server_port: p.shadowsocks.port,
                    method: p.shadowsocks.method,
                    password: user.ss_password,
                },
            };
        case 'hysteria2': {
            const h = p.hysteria2;
            return {
                outbound: {
                    type: 'hysteria2',
                    tag,
                    server,
                    server_port: h.port,
                    password: user.uuid,
                    tls: { enabled: true, server_name: s.domain || 'www.bing.com', alpn: ['h3'], ...(tls.selfSigned ? { insecure: true } : {}) },
                    ...(h.obfsPassword ? { obfs: { type: 'salamander', password: h.obfsPassword } } : {}),
                },
            };
        }
        case 'wireguard': {
            const w = p.wireguard;
            return {
                endpoint: {
                    type: 'wireguard',
                    tag,
                    mtu: w.mtu,
                    address: [`${wgClientIp(w.subnet, user.wg_index)}/32`],
                    private_key: user.wg_private_key,
                    peers: [{ address: server, port: w.port, public_key: w.publicKey, allowed_ips: ['0.0.0.0/0', '::/0'], persistent_keepalive_interval: 25 }],
                },
            };
        }
        default:
            return null;
    }
}

export function singboxConfig(protocols: Protocol[], user: UserRow, s: Settings, tls: TlsInfo, extraOutbounds: Obj[] = []): string {
    const outbounds: Obj[] = [...extraOutbounds];
    const endpoints: Obj[] = [];
    for (const protocol of protocols) {
        const r = singboxOutbound(protocol, user, s, tls);
        if (r?.outbound) outbounds.push(r.outbound);
        if (r?.endpoint) endpoints.push(r.endpoint);
    }
    const tags = [...outbounds, ...endpoints].map((o) => String(o.tag));
    const multiple = tags.length > 1;
    const doc = {
        log: { level: 'warn', timestamp: true },
        dns: {
            servers: [
                { type: 'https', tag: 'remote', server: '1.1.1.1', detour: 'proxy' },
                { type: 'local', tag: 'local' },
            ],
            final: 'remote',
            strategy: 'ipv4_only',
        },
        inbounds: [
            {
                type: 'tun',
                tag: 'tun-in',
                address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
                auto_route: true,
                strict_route: true,
                stack: 'mixed',
            },
            { type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: 2080 },
        ],
        outbounds: [
            { type: 'selector', tag: 'proxy', outbounds: multiple ? ['auto', ...tags] : tags, interrupt_exist_connections: true },
            ...(multiple ? [{ type: 'urltest', tag: 'auto', outbounds: tags, url: 'https://www.gstatic.com/generate_204', interval: '5m' }] : []),
            ...outbounds,
            { type: 'direct', tag: 'direct' },
        ],
        ...(endpoints.length ? { endpoints } : {}),
        route: {
            rules: [
                { action: 'sniff' },
                { protocol: 'dns', action: 'hijack-dns' },
                { ip_is_private: true, outbound: 'direct' },
            ],
            final: 'proxy',
            auto_detect_interface: true,
            default_domain_resolver: 'local',
        },
    };
    return JSON.stringify(doc, null, 2);
}
