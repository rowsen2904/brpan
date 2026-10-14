import { wgClientIp } from '../lib/net.js';
import type { Protocol, Settings, UserRow } from '../types.js';
import { publicHttpsPort } from './settings.js';
import { hasProtocol } from './users.js';

export const PROTOCOL_LABELS: Record<Protocol, string> = {
    'vless-reality': 'VLESS Reality',
    'vless-xhttp': 'VLESS XHTTP',
    'trojan-ws': 'Trojan WS',
    shadowsocks: 'Shadowsocks',
    hysteria2: 'Hysteria2',
    wireguard: 'WireGuard',
    amneziawg: 'AmneziaWG',
    openvpn: 'OpenVPN',
};

export interface TlsInfo {
    pinSha256: string | null;
    selfSigned: boolean;
}

function query(params: Record<string, string | number | undefined | null>): string {
    return Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
}

function host(address: string) {
    return address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
}

export function remark(s: Settings, protocol: Protocol) {
    return s.remarkPrefix ? `${s.remarkPrefix} ${PROTOCOL_LABELS[protocol]}` : PROTOCOL_LABELS[protocol];
}

export function serverAddress(s: Settings) {
    return s.serverAddress || s.domain;
}

export function shareLink(protocol: Protocol, user: UserRow, s: Settings, tls: TlsInfo): string | null {
    const p = s.protocols;
    const addr = host(serverAddress(s));
    const name = encodeURIComponent(remark(s, protocol));
    const httpsPort = publicHttpsPort(s);
    switch (protocol) {
        case 'vless-reality': {
            const r = p['vless-reality'];
            return `vless://${user.uuid}@${addr}:${r.port}?${query({
                type: 'tcp',
                security: 'reality',
                encryption: 'none',
                flow: 'xtls-rprx-vision',
                sni: r.serverNames[0],
                fp: r.fingerprint,
                pbk: r.publicKey,
                sid: r.shortIds[0],
            })}#${name}`;
        }
        case 'vless-xhttp': {
            if (!s.domain) return null;
            const x = p['vless-xhttp'];
            return `vless://${user.uuid}@${s.domain}:${httpsPort}?${query({
                type: 'xhttp',
                security: 'tls',
                encryption: 'none',
                sni: s.domain,
                host: s.domain,
                path: x.path,
                mode: x.mode,
                fp: 'chrome',
                alpn: 'h2,http/1.1',
            })}#${name}`;
        }
        case 'trojan-ws': {
            if (!s.domain) return null;
            const t = p['trojan-ws'];
            return `trojan://${encodeURIComponent(user.trojan_password)}@${s.domain}:${httpsPort}?${query({
                type: 'ws',
                security: 'tls',
                sni: s.domain,
                host: s.domain,
                path: t.path,
                fp: 'chrome',
                alpn: 'http/1.1',
            })}#${name}`;
        }
        case 'shadowsocks': {
            const ss = p.shadowsocks;
            const userinfo = Buffer.from(`${ss.method}:${user.ss_password}`).toString('base64');
            const prefix = ss.prefix ? `/?outline=1&prefix=${encodeURIComponent(ss.prefix)}` : '';
            return `ss://${userinfo}@${addr}:${ss.port}${prefix}#${name}`;
        }
        case 'hysteria2': {
            const h = p.hysteria2;
            const sni = s.domain || 'www.bing.com';
            return `hysteria2://${encodeURIComponent(user.uuid)}@${addr}:${h.port}/?${query({
                sni,
                insecure: tls.selfSigned ? 1 : undefined,
                pinSHA256: tls.selfSigned ? tls.pinSha256 : undefined,
                obfs: h.obfsPassword ? 'salamander' : undefined,
                'obfs-password': h.obfsPassword || undefined,
            })}#${name}`;
        }
        case 'wireguard': {
            const w = p.wireguard;
            return `wireguard://${encodeURIComponent(user.wg_private_key)}@${addr}:${w.port}?${query({
                publickey: w.publicKey,
                address: `${wgClientIp(w.subnet, user.wg_index)}/32`,
                mtu: w.mtu,
            })}#${name}`;
        }
        default:
            return null;
    }
}

export function availableProtocols(user: UserRow, s: Settings, hasHy2Tls: boolean): Protocol[] {
    return (Object.keys(s.protocols) as Protocol[]).filter((p) => {
        if (!s.protocols[p].enabled || !hasProtocol(user, p)) return false;
        if ((p === 'vless-xhttp' || p === 'trojan-ws') && !s.domain) return false;
        if (p === 'hysteria2' && !hasHy2Tls) return false;
        return true;
    });
}

export function outlineKey(user: UserRow, s: Settings) {
    const ss = s.protocols.shadowsocks;
    return {
        server: serverAddress(s),
        server_port: ss.port,
        password: user.ss_password,
        method: ss.method,
        ...(ss.prefix ? { prefix: ss.prefix } : {}),
    };
}

