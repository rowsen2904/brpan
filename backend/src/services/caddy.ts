import fs from 'node:fs';

import { config } from '../config.js';
import { getSettings } from './settings.js';

let lastApplied = '';
let lastError: string | null = null;

export function buildCaddyfile(): string {
    const s = getSettings();
    const x = s.protocols['vless-xhttp'];
    const t = s.protocols['trojan-ws'];
    const site = s.domain || (s.serverAddress ? `https://${s.serverAddress}` : '');
    if (!site) return '';
    const lines = [
        '{',
        '\tadmin 127.0.0.1:2019',
        `\thttps_port ${config.caddyHttpsPort}`,
        '\tservers {',
        '\t\tprotocols h1 h2',
        '\t}',
        '\tcert_issuer acme {',
        '\t\tdisable_tlsalpn_challenge',
        '\t}',
        '}',
        '',
        `${site} {`,
    ];
    if (!s.domain) lines.push('\ttls internal');
    if (x.enabled && s.domain) {
        lines.push(
            `\thandle ${x.path}* {`,
            `\t\treverse_proxy 127.0.0.1:${x.internalPort} {`,
            '\t\t\tflush_interval -1',
            '\t\t\ttransport http {',
            '\t\t\t\tversions h2c',
            '\t\t\t}',
            '\t\t}',
            '\t}',
        );
    }
    if (t.enabled && s.domain) {
        lines.push(`\thandle ${t.path}* {`, `\t\treverse_proxy 127.0.0.1:${t.internalPort}`, '\t}');
    }
    lines.push(
        '\thandle {',
        '\t\tencode zstd gzip',
        `\t\treverse_proxy 127.0.0.1:${config.port}`,
        '\t}',
        '\theader -Server',
        '}',
        '',
    );
    return lines.join('\n');
}

export async function applyCaddy(force = false): Promise<{ ok: boolean; error?: string }> {
    if (!config.caddyEnabled) return { ok: true };
    const text = buildCaddyfile();
    if (!text) return { ok: false, error: 'domain or server address is not set' };
    if (!force && text === lastApplied) return { ok: true };
    if (config.caddyfilePath) {
        try {
            fs.writeFileSync(config.caddyfilePath, text);
        } catch (e) {
            lastError = (e as Error).message;
        }
    }
    try {
        const res = await fetch(`${config.caddyAdmin}/load`, {
            method: 'POST',
            headers: { 'content-type': 'text/caddyfile' },
            body: text,
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        lastApplied = text;
        lastError = null;
        return { ok: true };
    } catch (e) {
        lastError = (e as Error).message;
        return { ok: false, error: lastError };
    }
}

export function caddyStatus() {
    return { enabled: config.caddyEnabled, applied: lastApplied !== '', error: lastError };
}
