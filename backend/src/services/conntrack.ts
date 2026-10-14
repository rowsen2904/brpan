import { all, run, tx } from '../db.js';
import { getSettings } from './settings.js';

// Xray access log line:
// 2026/... from 1.2.3.4:5678 accepted tcp:example.com:443 [vless-reality >> direct] email: 12
const LINE_RE = /accepted \w+:(.+):\d+ \[(\S+) >> direct\] email: (\d+)/;

interface Agg {
    host: string;
    protocol: string;
    count: number;
    last: number;
}

const pending = new Map<string, Agg>();

export function ingest(chunk: string) {
    if (!getSettings().logging.connectionLog) return;
    for (const line of chunk.split('\n')) {
        const m = LINE_RE.exec(line);
        if (!m) continue;
        const [, rawHost, inbound, userId] = m;
        if (inbound === 'api') continue;
        const host = rawHost.replace(/^\[|\]$/g, '');
        const key = `${userId}\t${host}`;
        const agg = pending.get(key);
        if (agg) {
            agg.count++;
            agg.last = Date.now();
        } else {
            pending.set(key, { host, protocol: inbound, count: 1, last: Date.now() });
        }
    }
}

export function flushConnections() {
    if (!getSettings().logging.connectionLog) {
        pending.clear();
        return;
    }
    if (pending.size === 0) return;
    const entries = [...pending.entries()];
    pending.clear();
    const ids = new Set(all<{ id: number }>('SELECT id FROM users').map((r) => r.id));
    tx(() => {
        for (const [key, agg] of entries) {
            const userId = Number(key.slice(0, key.indexOf('\t')));
            if (!ids.has(userId)) continue;
            run(
                `INSERT INTO connection_log (user_id, host, protocol, hits, first_seen, last_seen)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(user_id, host) DO UPDATE SET hits = hits + excluded.hits, last_seen = excluded.last_seen, protocol = excluded.protocol`,
                userId,
                agg.host,
                agg.protocol,
                agg.count,
                agg.last,
                agg.last,
            );
        }
    });
}

export function userConnections(userId: number, limit = 200) {
    return all<{ host: string; protocol: string; hits: number; last_seen: number; first_seen: number }>(
        'SELECT host, protocol, hits, first_seen, last_seen FROM connection_log WHERE user_id = ? ORDER BY last_seen DESC LIMIT ?',
        userId,
        limit,
    );
}

export function clearUserConnections(userId: number) {
    run('DELETE FROM connection_log WHERE user_id = ?', userId);
}

export function clearAllConnections() {
    pending.clear();
    run('DELETE FROM connection_log');
}

export function purgeOldConnections(now = Date.now()) {
    run('DELETE FROM connection_log WHERE last_seen < ?', now - getSettings().logging.retentionDays * 86_400_000);
}
