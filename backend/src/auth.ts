import type { FastifyReply, FastifyRequest } from 'fastify';

import { config } from './config.js';
import { get, run } from './db.js';
import { hashPassword, randomHex, randomString, sha256, signJwt, verifyJwt } from './lib/crypto.js';
import { getSecret } from './services/settings.js';

export const jwtSecret = () => getSecret('jwt_secret', () => randomHex(32));

export function ensureAdmin(log: (msg: string) => void) {
    const count = get<{ c: number }>('SELECT COUNT(*) AS c FROM admins')!.c;
    if (count > 0) return;
    const password = config.adminPassword || randomString(16);
    run(
        'INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)',
        config.adminUsername,
        hashPassword(password),
        Date.now(),
    );
    if (!config.adminPassword) {
        log(`Admin account created: ${config.adminUsername} / ${password}`);
    }
}

export function issueToken(adminId: number, username: string) {
    return signJwt({ sub: adminId, username }, jwtSecret(), 7 * 86_400);
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token) {
        const payload = verifyJwt<{ sub: number }>(token, jwtSecret());
        if (payload && get('SELECT 1 FROM admins WHERE id = ?', payload.sub)) return;
        if (get('SELECT 1 FROM api_tokens WHERE token_hash = ?', sha256(token))) return;
    }
    return reply.code(401).send({ error: 'Unauthorized' });
}

const attempts = new Map<string, { count: number; until: number }>();

export function loginAllowed(ip: string): boolean {
    const a = attempts.get(ip);
    return !a || a.until < Date.now() || a.count < 5;
}

export function loginFailed(ip: string) {
    const a = attempts.get(ip);
    if (!a || a.until < Date.now()) attempts.set(ip, { count: 1, until: Date.now() + 15 * 60_000 });
    else a.count++;
}

export function loginSucceeded(ip: string) {
    attempts.delete(ip);
}

export function pruneLoginAttempts(now = Date.now()) {
    for (const [ip, a] of attempts) if (a.until < now) attempts.delete(ip);
}
