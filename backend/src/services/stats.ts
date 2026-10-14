import { all, get, run, tx } from '../db.js';
import { bus } from '../lib/bus.js';
import { getSettings } from './settings.js';
import { blockUser, expireUsers, getUser, periodicResets, refreshStatus } from './users.js';
import { xray } from './xray.js';

const hourOf = (ts: number) => Math.floor(ts / 3_600_000);

export function addUserTraffic(userId: number, up: number, down: number, now = Date.now()) {
    const total = up + down;
    if (total <= 0) return;
    run(
        'UPDATE users SET traffic_used = traffic_used + ?, lifetime_used = lifetime_used + ?, online_at = ? WHERE id = ?',
        total,
        total,
        now,
        userId,
    );
    run(
        `INSERT INTO user_usage (user_id, hour, up, down) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, hour) DO UPDATE SET up = up + excluded.up, down = down + excluded.down`,
        userId,
        hourOf(now),
        up,
        down,
    );
}

export function addProtocolTraffic(protocol: string, up: number, down: number, now = Date.now()) {
    if (up + down <= 0) return;
    run(
        `INSERT INTO protocol_usage (protocol, hour, up, down) VALUES (?, ?, ?, ?)
         ON CONFLICT(protocol, hour) DO UPDATE SET up = up + excluded.up, down = down + excluded.down`,
        protocol,
        hourOf(now),
        up,
        down,
    );
}

export function touchIp(userId: number, ip: string, protocol: string, now = Date.now()) {
    run(
        `INSERT INTO user_ips (user_id, ip, protocol, last_seen) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, ip) DO UPDATE SET last_seen = excluded.last_seen, protocol = excluded.protocol`,
        userId,
        ip,
        protocol,
        now,
    );
    run('UPDATE users SET online_at = ? WHERE id = ?', now, userId);
}

export function enforceLimits(userIds: Iterable<number>) {
    for (const id of userIds) {
        const user = getUser(id);
        if (!user) continue;
        const updated = refreshStatus(user);
        if (updated.status !== user.status) bus.emitEvent('user:changed', updated);
    }
}

function enforceIpLimit(now: number) {
    const s = getSettings();
    if (!s.limits.enforceIpLimit) return;
    const since = now - s.limits.ipWindowSec * 1000;
    const rows = all<{ id: number; device_limit: number; ips: number }>(
        `SELECT u.id, u.device_limit, COUNT(i.ip) AS ips FROM users u JOIN user_ips i ON i.user_id = u.id
         WHERE u.device_limit > 0 AND u.status = 'ACTIVE' AND (u.blocked_until IS NULL OR u.blocked_until <= ?) AND i.last_seen > ?
         GROUP BY u.id HAVING ips > u.device_limit`,
        now,
        since,
    );
    for (const row of rows) blockUser(row.id, s.limits.blockMinutes);
}

let collecting = false;

export async function collectXrayStats() {
    if (collecting || !xray.running) return;
    collecting = true;
    try {
        const now = Date.now();
        const [usersRes, onlineRes, inboundsRes] = await Promise.all([
            xray.api.stats.getAllUsersStats(true),
            xray.api.stats.getUsersStats(false, false),
            xray.api.stats.getAllInboundsStats(true),
        ]);
        const touched = new Set<number>();
        tx(() => {
            if (usersRes.isOk) {
                for (const u of usersRes.data!.users) {
                    const id = Number(u.username);
                    if (!Number.isInteger(id)) continue;
                    if (u.uplink + u.downlink > 0) {
                        addUserTraffic(id, u.uplink, u.downlink, now);
                        touched.add(id);
                    }
                }
            }
            if (onlineRes.isOk) {
                for (const u of onlineRes.data!.users ?? []) {
                    const id = Number(u.userId);
                    if (!Number.isInteger(id) || !get('SELECT 1 FROM users WHERE id = ?', id)) continue;
                    for (const ip of u.ips) touchIp(id, ip.ip, 'xray', now);
                }
            }
            if (inboundsRes.isOk) {
                for (const i of inboundsRes.data!.inbounds) {
                    if (i.inbound === 'api') continue;
                    addProtocolTraffic(i.inbound, i.uplink, i.downlink, now);
                }
            }
        });
        enforceLimits(touched);
        enforceIpLimit(now);
    } catch (e) {
        xray.logs.push(`[panel] stats collection failed: ${(e as Error).message}`);
    } finally {
        collecting = false;
    }
}

export function housekeeping() {
    const now = Date.now();
    expireUsers(now);
    periodicResets(new Date(now));
    run('DELETE FROM user_ips WHERE last_seen < ?', now - 7 * 86_400_000);
    run('DELETE FROM user_usage WHERE hour < ?', hourOf(now - 400 * 86_400_000));
    run('DELETE FROM protocol_usage WHERE hour < ?', hourOf(now - 400 * 86_400_000));
}

export function usageSeries(days: number, userId?: number) {
    const fromHour = hourOf(Date.now() - days * 86_400_000);
    const rows = userId
        ? all<{ hour: number; up: number; down: number }>(
              'SELECT hour, up, down FROM user_usage WHERE user_id = ? AND hour >= ? ORDER BY hour',
              userId,
              fromHour,
          )
        : all<{ hour: number; up: number; down: number }>(
              'SELECT hour, SUM(up) AS up, SUM(down) AS down FROM user_usage WHERE hour >= ? GROUP BY hour ORDER BY hour',
              fromHour,
          );
    return bucketByDay(rows, days);
}

function bucketByDay(rows: { hour: number; up: number; down: number }[], days: number) {
    const buckets = new Map<string, { date: string; up: number; down: number }>();
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today.getTime() - i * 86_400_000);
        const key = d.toISOString().slice(0, 10);
        buckets.set(key, { date: key, up: 0, down: 0 });
    }
    for (const r of rows) {
        const key = new Date(r.hour * 3_600_000).toISOString().slice(0, 10);
        const b = buckets.get(key);
        if (b) {
            b.up += r.up;
            b.down += r.down;
        }
    }
    return [...buckets.values()];
}

export function protocolTotals(days: number) {
    const fromHour = hourOf(Date.now() - days * 86_400_000);
    return all<{ protocol: string; up: number; down: number }>(
        'SELECT protocol, SUM(up) AS up, SUM(down) AS down FROM protocol_usage WHERE hour >= ? GROUP BY protocol ORDER BY (SUM(up) + SUM(down)) DESC',
        fromHour,
    );
}

export function topUsers(days: number, limit = 10) {
    const fromHour = hourOf(Date.now() - days * 86_400_000);
    return all<{ id: number; username: string; total: number }>(
        `SELECT u.id, u.username, SUM(x.up + x.down) AS total FROM user_usage x JOIN users u ON u.id = x.user_id
         WHERE x.hour >= ? GROUP BY u.id ORDER BY total DESC LIMIT ?`,
        fromHour,
        limit,
    );
}

export function userCounters() {
    const now = Date.now();
    const rows = all<{ status: string; c: number }>('SELECT status, COUNT(*) AS c FROM users GROUP BY status');
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.c])) as Record<string, number>;
    const online = get<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE online_at > ?', now - 60_000)!.c;
    const onlineDay = get<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE online_at > ?', now - 86_400_000)!.c;
    const neverOnline = get<{ c: number }>('SELECT COUNT(*) AS c FROM users WHERE online_at IS NULL')!.c;
    const expiringSoon = get<{ c: number }>(
        "SELECT COUNT(*) AS c FROM users WHERE status = 'ACTIVE' AND expire_at IS NOT NULL AND expire_at < ?",
        now + 3 * 86_400_000,
    )!.c;
    const totals = get<{ total: number; lifetime: number }>(
        'SELECT COUNT(*) AS total, COALESCE(SUM(lifetime_used), 0) AS lifetime FROM users',
    )!;
    const devices = get<{ c: number }>('SELECT COUNT(*) AS c FROM devices')!.c;
    return {
        total: totals.total,
        active: byStatus.ACTIVE ?? 0,
        disabled: byStatus.DISABLED ?? 0,
        limited: byStatus.LIMITED ?? 0,
        expired: byStatus.EXPIRED ?? 0,
        online,
        onlineDay,
        neverOnline,
        expiringSoon,
        lifetimeTraffic: totals.lifetime,
        devices,
    };
}

export function trafficSince(ms: number) {
    const fromHour = hourOf(Date.now() - ms);
    return get<{ up: number; down: number }>(
        'SELECT COALESCE(SUM(up), 0) AS up, COALESCE(SUM(down), 0) AS down FROM user_usage WHERE hour >= ?',
        fromHour,
    )!;
}
