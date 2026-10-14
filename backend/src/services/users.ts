import { all, get, run, tx } from '../db.js';
import { bus } from '../lib/bus.js';
import { randomString, uuid, wgKeyPair } from '../lib/crypto.js';
import { PROTOCOLS, type Protocol, type ResetStrategy, type UserRow, type UserStatus } from '../types.js';

export interface UserInput {
    username: string;
    status?: 'ACTIVE' | 'DISABLED';
    protocols?: Protocol[];
    trafficLimit?: number;
    resetStrategy?: ResetStrategy;
    expireAt?: number | null;
    deviceLimit?: number;
    note?: string;
    telegramId?: string | null;
    email?: string | null;
}

export interface ListQuery {
    search?: string;
    status?: UserStatus | 'ONLINE';
    offset?: number;
    limit?: number;
    sort?: 'created_at' | 'traffic_used' | 'expire_at' | 'username' | 'online_at';
    order?: 'asc' | 'desc';
}

export function parseProtocols(user: UserRow): Protocol[] {
    try {
        const list = JSON.parse(user.protocols) as string[];
        return list.filter((p): p is Protocol => (PROTOCOLS as readonly string[]).includes(p));
    } catch {
        return [];
    }
}

export function isActive(user: UserRow, now = Date.now()): boolean {
    return user.status === 'ACTIVE' && !(user.blocked_until && user.blocked_until > now);
}

export function hasProtocol(user: UserRow, protocol: Protocol): boolean {
    return parseProtocols(user).includes(protocol);
}

export function getUser(id: number): UserRow | undefined {
    return get<UserRow>('SELECT * FROM users WHERE id = ?', id);
}

export function getUserByShortId(shortId: string): UserRow | undefined {
    return get<UserRow>('SELECT * FROM users WHERE short_id = ?', shortId);
}

export function getUserByUsername(username: string): UserRow | undefined {
    return get<UserRow>('SELECT * FROM users WHERE username = ?', username);
}

export function allUsers(): UserRow[] {
    return all<UserRow>('SELECT * FROM users ORDER BY id');
}

export function listUsers(q: ListQuery) {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (q.search) {
        where.push('(username LIKE ? OR short_id = ? OR uuid = ? OR note LIKE ? OR telegram_id = ? OR email LIKE ?)');
        const like = `%${q.search}%`;
        params.push(like, q.search, q.search, like, q.search, like);
    }
    if (q.status === 'ONLINE') {
        where.push('online_at > ?');
        params.push(Date.now() - 60_000);
    } else if (q.status) {
        where.push('status = ?');
        params.push(q.status);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sort = q.sort ?? 'created_at';
    const order = q.order === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(q.limit ?? 25, 500);
    const offset = q.offset ?? 0;
    const total = get<{ c: number }>(`SELECT COUNT(*) AS c FROM users ${whereSql}`, ...params)!.c;
    const rows = all<UserRow>(
        `SELECT * FROM users ${whereSql} ORDER BY ${sort} ${order} NULLS LAST, id DESC LIMIT ? OFFSET ?`,
        ...params,
        limit,
        offset,
    );
    return { total, rows };
}

function nextWgIndex(): number {
    const used = new Set(all<{ wg_index: number }>('SELECT wg_index FROM users').map((r) => r.wg_index));
    let i = 1;
    while (used.has(i)) i++;
    return i;
}

function credentials() {
    const wg = wgKeyPair();
    return {
        uuid: uuid(),
        short_id: randomString(16),
        trojan_password: randomString(24),
        ss_password: randomString(24),
        wg_private_key: wg.privateKey,
        wg_public_key: wg.publicKey,
    };
}

export function createUser(input: UserInput): UserRow {
    const now = Date.now();
    const c = credentials();
    const user = tx(() => {
        const res = run(
            `INSERT INTO users (username, uuid, short_id, status, trojan_password, ss_password, wg_private_key, wg_public_key,
                wg_index, protocols, traffic_limit, reset_strategy, last_reset_at, expire_at, device_limit, note, telegram_id, email,
                created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            input.username,
            c.uuid,
            c.short_id,
            input.status ?? 'ACTIVE',
            c.trojan_password,
            c.ss_password,
            c.wg_private_key,
            c.wg_public_key,
            nextWgIndex(),
            JSON.stringify(input.protocols ?? [...PROTOCOLS]),
            input.trafficLimit ?? 0,
            input.resetStrategy ?? 'NO_RESET',
            now,
            input.expireAt ?? null,
            input.deviceLimit ?? 0,
            input.note ?? '',
            input.telegramId ?? null,
            input.email ?? null,
            now,
            now,
        );
        return getUser(Number(res.lastInsertRowid))!;
    });
    const checked = refreshStatus(user);
    bus.emitEvent('user:changed', checked);
    return checked;
}

export function updateUser(id: number, input: Partial<UserInput>): UserRow {
    const user = getUser(id);
    if (!user) throw new Error('User not found');
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const set = (col: string, value: string | number | null) => {
        sets.push(`${col} = ?`);
        params.push(value);
    };
    if (input.username !== undefined) set('username', input.username);
    if (input.protocols !== undefined) set('protocols', JSON.stringify(input.protocols));
    if (input.trafficLimit !== undefined) set('traffic_limit', input.trafficLimit);
    if (input.resetStrategy !== undefined) set('reset_strategy', input.resetStrategy);
    if (input.expireAt !== undefined) set('expire_at', input.expireAt);
    if (input.deviceLimit !== undefined) set('device_limit', input.deviceLimit);
    if (input.note !== undefined) set('note', input.note);
    if (input.telegramId !== undefined) set('telegram_id', input.telegramId);
    if (input.email !== undefined) set('email', input.email);
    if (input.status === 'DISABLED') set('status', 'DISABLED');
    if (input.status === 'ACTIVE' && user.status === 'DISABLED') set('status', 'ACTIVE');
    set('updated_at', Date.now());
    run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
    const updated = refreshStatus(getUser(id)!);
    // Only status and protocols matter to the cores; a note or expiry edit must not
    // remove-and-re-add the user in every inbound.
    if (updated.status !== user.status || updated.protocols !== user.protocols) bus.emitEvent('user:changed', updated);
    return updated;
}

export function computeStatus(user: UserRow, now = Date.now()): UserStatus {
    if (user.status === 'DISABLED') return 'DISABLED';
    if (user.expire_at && user.expire_at <= now) return 'EXPIRED';
    if (user.traffic_limit > 0 && user.traffic_used >= user.traffic_limit) return 'LIMITED';
    return 'ACTIVE';
}

export function refreshStatus(user: UserRow): UserRow {
    const status = computeStatus(user);
    if (status === user.status) return user;
    run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', status, Date.now(), user.id);
    return { ...user, status };
}

export function setStatus(id: number, status: 'ACTIVE' | 'DISABLED'): UserRow {
    return updateUser(id, { status });
}

export function deleteUser(id: number) {
    const user = getUser(id);
    if (!user) return;
    run('DELETE FROM users WHERE id = ?', id);
    bus.emitEvent('user:deleted', user);
}

export function resetTraffic(id: number): UserRow {
    const before = getUser(id);
    if (!before) throw new Error('User not found');
    run('UPDATE users SET traffic_used = 0, last_reset_at = ?, updated_at = ? WHERE id = ?', Date.now(), Date.now(), id);
    const user = refreshStatus(getUser(id)!);
    if (user.status !== before.status) bus.emitEvent('user:changed', user);
    return user;
}

export function revokeUser(id: number): UserRow {
    const old = getUser(id);
    if (!old) throw new Error('User not found');
    const c = credentials();
    run(
        `UPDATE users SET uuid = ?, short_id = ?, trojan_password = ?, ss_password = ?, wg_private_key = ?, wg_public_key = ?,
            ovpn_serial = NULL, updated_at = ? WHERE id = ?`,
        c.uuid,
        c.short_id,
        c.trojan_password,
        c.ss_password,
        c.wg_private_key,
        c.wg_public_key,
        Date.now(),
        id,
    );
    run('DELETE FROM devices WHERE user_id = ?', id);
    bus.emitEvent('user:deleted', old);
    const user = getUser(id)!;
    bus.emitEvent('user:changed', user);
    return user;
}

export function bulkAction(
    ids: number[],
    action: 'enable' | 'disable' | 'delete' | 'reset' | 'revoke' | 'extend',
    days = 30,
) {
    for (const id of ids) {
        const user = getUser(id);
        if (!user) continue;
        switch (action) {
            case 'enable':
                setStatus(id, 'ACTIVE');
                break;
            case 'disable':
                setStatus(id, 'DISABLED');
                break;
            case 'delete':
                deleteUser(id);
                break;
            case 'reset':
                resetTraffic(id);
                break;
            case 'revoke':
                revokeUser(id);
                break;
            case 'extend': {
                const base = Math.max(user.expire_at ?? Date.now(), Date.now());
                updateUser(id, { expireAt: base + days * 86_400_000 });
                break;
            }
        }
    }
}

export function periodicResets(now = new Date()) {
    const users = all<UserRow>("SELECT * FROM users WHERE reset_strategy != 'NO_RESET'");
    for (const user of users) {
        const last = new Date(user.last_reset_at ?? user.created_at);
        let due = false;
        switch (user.reset_strategy) {
            case 'DAY':
                due = now.toDateString() !== last.toDateString();
                break;
            case 'WEEK': {
                const startOfWeek = new Date(now);
                startOfWeek.setHours(0, 0, 0, 0);
                startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7));
                due = last < startOfWeek;
                break;
            }
            case 'MONTH':
                due = now.getMonth() !== last.getMonth() || now.getFullYear() !== last.getFullYear();
                break;
        }
        if (due) resetTraffic(user.id);
    }
}

export function expireUsers(now = Date.now()) {
    const users = all<UserRow>(
        "SELECT * FROM users WHERE status IN ('ACTIVE', 'EXPIRED', 'LIMITED') OR blocked_until IS NOT NULL",
    );
    for (const user of users) {
        const status = computeStatus(user, now);
        const unblock = user.blocked_until !== null && user.blocked_until <= now;
        if (status !== user.status || unblock) {
            run(
                'UPDATE users SET status = ?, blocked_until = ?, updated_at = ? WHERE id = ?',
                status,
                unblock ? null : user.blocked_until,
                now,
                user.id,
            );
            bus.emitEvent('user:changed', getUser(user.id)!);
        }
    }
}

export function blockUser(id: number, minutes: number) {
    run('UPDATE users SET blocked_until = ? WHERE id = ?', Date.now() + minutes * 60_000, id);
    bus.emitEvent('user:changed', getUser(id)!);
}

export function listDevices(userId: number) {
    return all<Record<string, unknown>>('SELECT * FROM devices WHERE user_id = ? ORDER BY updated_at DESC', userId);
}

export function deleteDevice(userId: number, deviceId?: number) {
    if (deviceId === undefined) run('DELETE FROM devices WHERE user_id = ?', userId);
    else run('DELETE FROM devices WHERE user_id = ? AND id = ?', userId, deviceId);
}

export function userIps(userId: number) {
    return all<{ ip: string; protocol: string; last_seen: number }>(
        'SELECT ip, protocol, last_seen FROM user_ips WHERE user_id = ? ORDER BY last_seen DESC LIMIT 50',
        userId,
    );
}
