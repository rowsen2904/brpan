import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { issueToken, loginAllowed, loginFailed, loginSucceeded, requireAuth } from '../auth.js';
import { all, get, run } from '../db.js';
import { bus } from '../lib/bus.js';
import { hashPassword, randomString, realityKeyPair, sha256, verifyPassword, wgKeyPair } from '../lib/crypto.js';
import { applyCaddy, buildCaddyfile, caddyStatus } from '../services/caddy.js';
import { userDto } from '../services/dto.js';
import {
    createSquad,
    defaultSquadIds,
    deleteSquad,
    getSquad,
    listSquads,
    protocolsForSquads,
    setUserSquads,
    squadIdsByUser,
    updateSquad,
    userSquadIds,
    validSquadIds,
} from '../services/squads.js';
import { openvpn } from '../services/openvpn.js';
import { getSettings, publicBaseUrl, updateSettings } from '../services/settings.js';
import { protocolTotals, topUsers, trafficSince, usageSeries, userCounters } from '../services/stats.js';
import { clearAllConnections, clearUserConnections, userConnections } from '../services/conntrack.js';
import { userSubscriptionInfo } from '../services/subscription.js';
import { systemInfo } from '../services/system.js';
import {
    bulkAction,
    createUser,
    deleteDevice,
    deleteUser,
    getUser,
    getUserByUsername,
    listDevices,
    listUsers,
    resetTraffic,
    revokeUser,
    setStatus,
    updateUser,
    userIps,
} from '../services/users.js';
import { amneziawg, wireguard } from '../services/wireguard.js';
import { xray } from '../services/xray.js';
import { PROTOCOLS, RESET_STRATEGIES, USER_STATUSES, type Protocol } from '../types.js';

const userBody = z.object({
    username: z.string().trim().min(1).max(64).regex(/^[\w.@+-]+$/, 'Only letters, digits and _.@+- are allowed'),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    protocols: z.array(z.enum(PROTOCOLS)).optional(),
    trafficLimit: z.number().int().min(0).optional(),
    resetStrategy: z.enum(RESET_STRATEGIES).optional(),
    expireAt: z.number().int().nullable().optional(),
    deviceLimit: z.number().int().min(0).max(1000).optional(),
    note: z.string().max(1000).optional(),
    telegramId: z.string().max(64).nullable().optional(),
    email: z.string().max(255).nullable().optional(),
    squadIds: z.array(z.number().int()).optional(),
});

const squadBody = z.object({
    name: z.string().trim().min(1).max(40),
    protocols: z.array(z.enum(PROTOCOLS)),
});

// squadIds wins; plain protocols mean a custom set (no squads); nothing on create = default squad.
function resolveAccess(body: { squadIds?: number[]; protocols?: Protocol[] }, isCreate: boolean) {
    if (body.squadIds !== undefined) {
        const squadIds = validSquadIds(body.squadIds);
        return { protocols: protocolsForSquads(squadIds), squadIds };
    }
    if (body.protocols !== undefined) return { protocols: body.protocols, squadIds: [] as number[] };
    if (isCreate) {
        const squadIds = defaultSquadIds();
        return { protocols: protocolsForSquads(squadIds), squadIds };
    }
    return { protocols: undefined, squadIds: undefined };
}

const userTemplate = userBody.omit({ username: true } as const);

const listQuery = z.object({
    search: z.string().optional(),
    status: z.enum([...USER_STATUSES, 'ONLINE']).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    sort: z.enum(['created_at', 'traffic_used', 'expire_at', 'username', 'online_at']).optional(),
    order: z.enum(['asc', 'desc']).optional(),
});

const idParam = z.object({ id: z.coerce.number().int() });

const settingsPatch = z
    .object({
        domain: z.string().trim().max(253),
        serverAddress: z.string().trim().max(253),
        remarkPrefix: z.string().max(64),
        country: z.string().regex(/^([A-Za-z]{2})?$/),
        mainProtocol: z.enum(PROTOCOLS).nullable(),
        subscription: z
            .object({
                profileTitle: z.string().min(1).max(64),
                updateIntervalHours: z.number().int().min(1).max(168),
                supportUrl: z.string().max(255),
                announce: z.string().max(200),
                happCrypto: z.enum(['none', 'v2', 'v3', 'v4']),
                hwidRequired: z.boolean(),
                showDisabledNotice: z.boolean(),
            })
            .partial(),
        limits: z
            .object({
                enforceIpLimit: z.boolean(),
                ipWindowSec: z.number().int().min(10).max(3600),
                blockMinutes: z.number().int().min(1).max(1440),
            })
            .partial(),
        logging: z
            .object({
                connectionLog: z.boolean(),
                retentionDays: z.number().int().min(1).max(365),
            })
            .partial(),
        protocols: z
            .object({
                'vless-reality': z
                    .object({
                        enabled: z.boolean(),
                        port: z.number().int().min(1).max(65535),
                        target: z.string().min(3),
                        serverNames: z.array(z.string().min(1)).min(1),
                        privateKey: z.string().min(40),
                        shortIds: z.array(z.string().regex(/^[0-9a-f]{0,16}$/)).min(1),
                        fingerprint: z.string(),
                    })
                    .partial(),
                'vless-xhttp': z
                    .object({ enabled: z.boolean(), path: z.string().regex(/^\/[\w-]+$/), mode: z.enum(['auto', 'packet-up', 'stream-up', 'stream-one']) })
                    .partial(),
                'trojan-ws': z.object({ enabled: z.boolean(), path: z.string().regex(/^\/[\w-]+$/) }).partial(),
                shadowsocks: z
                    .object({
                        enabled: z.boolean(),
                        port: z.number().int().min(1).max(65535),
                        method: z.enum(['chacha20-ietf-poly1305', 'aes-256-gcm', 'aes-128-gcm']),
                        prefix: z.string().max(64),
                    })
                    .partial(),
                hysteria2: z
                    .object({ enabled: z.boolean(), port: z.number().int().min(1).max(65535), obfsPassword: z.string().max(128) })
                    .partial(),
                wireguard: z
                    .object({
                        enabled: z.boolean(),
                        port: z.number().int().min(1).max(65535),
                        subnet: z.string().regex(/^\d+\.\d+\.\d+\.\d+\/(1[6-9]|2[0-4])$/),
                        mtu: z.number().int().min(1280).max(1500),
                        dns: z.string().max(128),
                    })
                    .partial(),
                amneziawg: z
                    .object({
                        enabled: z.boolean(),
                        port: z.number().int().min(1).max(65535),
                        subnet: z.string().regex(/^\d+\.\d+\.\d+\.\d+\/(1[6-9]|2[0-4])$/),
                        mtu: z.number().int().min(1200).max(1500),
                        dns: z.string().max(128),
                        jc: z.number().int().min(1).max(128),
                        jmin: z.number().int().min(0).max(1280),
                        jmax: z.number().int().min(1).max(1280),
                        s1: z.number().int().min(0).max(1132),
                        s2: z.number().int().min(0).max(1188),
                        h1: z.number().int().min(5).max(4294967295),
                        h2: z.number().int().min(5).max(4294967295),
                        h3: z.number().int().min(5).max(4294967295),
                        h4: z.number().int().min(5).max(4294967295),
                    })
                    .partial(),
                openvpn: z
                    .object({
                        enabled: z.boolean(),
                        port: z.number().int().min(1).max(65535),
                        proto: z.enum(['udp', 'tcp']),
                        subnet: z.string().regex(/^\d+\.\d+\.\d+\.\d+\/(1[6-9]|2[0-4])$/),
                        dns: z.string().max(128),
                    })
                    .partial(),
            })
            .partial(),
    })
    .partial();

function settingsDto() {
    const s = getSettings();
    return { ...s, publicBaseUrl: publicBaseUrl(s) };
}

export async function apiRoutes(app: FastifyInstance) {
    app.post('/api/auth/login', async (req, reply) => {
        const body = z.object({ username: z.string(), password: z.string() }).parse(req.body);
        if (!loginAllowed(req.ip)) return reply.code(429).send({ error: 'Too many attempts, try again later' });
        const admin = get<{ id: number; username: string; password_hash: string }>(
            'SELECT * FROM admins WHERE username = ?',
            body.username,
        );
        if (!admin || !verifyPassword(body.password, admin.password_hash)) {
            loginFailed(req.ip);
            return reply.code(401).send({ error: 'Invalid username or password' });
        }
        loginSucceeded(req.ip);
        return { token: issueToken(admin.id, admin.username), username: admin.username };
    });

    app.register(async (r) => {
        r.addHook('preHandler', requireAuth);

        r.get('/api/auth/me', async () => {
            const admin = get<{ username: string }>('SELECT username FROM admins ORDER BY id LIMIT 1');
            return { username: admin?.username };
        });

        r.post('/api/auth/password', async (req, reply) => {
            const body = z.object({ current: z.string(), next: z.string().min(8), username: z.string().min(3).optional() }).parse(req.body);
            const admin = get<{ id: number; password_hash: string }>('SELECT * FROM admins ORDER BY id LIMIT 1')!;
            if (!verifyPassword(body.current, admin.password_hash)) return reply.code(400).send({ error: 'Current password is wrong' });
            run('UPDATE admins SET password_hash = ? WHERE id = ?', hashPassword(body.next), admin.id);
            if (body.username) run('UPDATE admins SET username = ? WHERE id = ?', body.username, admin.id);
            return { ok: true };
        });

        r.get('/api/dashboard', async () => {
            const day = 86_400_000;
            return {
                users: userCounters(),
                country: getSettings().country,
                system: systemInfo(),
                cores: {
                    xray: { enabled: true, running: xray.running, version: xray.version, uptime: xray.uptime },
                    openvpn: { enabled: getSettings().protocols.openvpn.enabled, running: openvpn.running, version: openvpn.version, uptime: openvpn.uptime },
                    wireguard: { enabled: getSettings().protocols.wireguard.enabled, running: wireguard.running, uptime: wireguard.uptime },
                    amneziawg: { enabled: getSettings().protocols.amneziawg.enabled, running: amneziawg.running, uptime: amneziawg.uptime },
                    caddy: caddyStatus(),
                },
                traffic: {
                    today: trafficSince(Date.now() - new Date().setHours(0, 0, 0, 0)),
                    week: trafficSince(7 * day),
                    month: trafficSince(30 * day),
                },
                series: usageSeries(30),
                protocols: protocolTotals(30),
                topUsers: topUsers(30, 8),
            };
        });

        r.get('/api/users', async (req) => {
            const q = listQuery.parse(req.query);
            const { total, rows } = listUsers(q);
            const squads = squadIdsByUser();
            return { total, users: rows.map((u) => userDto(u, squads.get(u.id) ?? [])) };
        });

        r.post('/api/users', async (req, reply) => {
            const body = userBody.parse(req.body);
            if (getUserByUsername(body.username)) return reply.code(409).send({ error: 'Username already exists' });
            const { squadIds: _ignored, ...input } = body;
            const access = resolveAccess(body, true);
            const user = createUser({ ...input, protocols: access.protocols });
            if (access.squadIds) setUserSquads(user.id, access.squadIds);
            return userDto(user, userSquadIds(user.id));
        });

        r.post('/api/users/bulk-create', async (req) => {
            const body = z
                .object({ prefix: z.string().regex(/^[\w.-]+$/).max(40), count: z.number().int().min(1).max(500), template: userTemplate })
                .parse(req.body);
            const created = [];
            for (let i = 0; i < body.count; i++) {
                let username = `${body.prefix}${randomString(5).toLowerCase()}`;
                while (getUserByUsername(username)) username = `${body.prefix}${randomString(6).toLowerCase()}`;
                const { squadIds: _ignored, ...input } = body.template;
                const access = resolveAccess(body.template, true);
                const user = createUser({ ...input, username, protocols: access.protocols });
                if (access.squadIds) setUserSquads(user.id, access.squadIds);
                created.push(userDto(user, userSquadIds(user.id)));
            }
            return { users: created };
        });

        r.post('/api/users/bulk', async (req) => {
            const body = z
                .object({
                    ids: z.array(z.number().int()).min(1).max(5000),
                    action: z.enum(['enable', 'disable', 'delete', 'reset', 'revoke', 'extend']),
                    days: z.number().int().min(1).max(3650).optional(),
                })
                .parse(req.body);
            bulkAction(body.ids, body.action, body.days);
            return { ok: true };
        });

        r.get('/api/users/:id', async (req, reply) => {
            const { id } = idParam.parse(req.params);
            const user = getUser(id);
            if (!user) return reply.code(404).send({ error: 'User not found' });
            return {
                user: userDto(user, userSquadIds(id)),
                subscription: userSubscriptionInfo(user),
                devices: listDevices(id),
                ips: userIps(id),
                usage: usageSeries(30, id),
                connectionLog: getSettings().logging.connectionLog,
                connections: getSettings().logging.connectionLog ? userConnections(id) : [],
            };
        });

        r.patch('/api/users/:id', async (req, reply) => {
            const { id } = idParam.parse(req.params);
            const body = userBody.partial().parse(req.body);
            if (body.username) {
                const other = getUserByUsername(body.username);
                if (other && other.id !== id) return reply.code(409).send({ error: 'Username already exists' });
            }
            if (!getUser(id)) return reply.code(404).send({ error: 'User not found' });
            const { squadIds: _ignored, protocols: _p, ...input } = body;
            const access = resolveAccess(body, false);
            const user = updateUser(id, { ...input, ...(access.protocols ? { protocols: access.protocols } : {}) });
            if (access.squadIds) setUserSquads(id, access.squadIds);
            return userDto(user, userSquadIds(id));
        });

        r.get('/api/squads', async () => listSquads());

        r.post('/api/squads', async (req, reply) => {
            const body = squadBody.parse(req.body);
            if (listSquads().some((sq) => sq.name.toLowerCase() === body.name.toLowerCase())) {
                return reply.code(409).send({ error: 'Squad name already exists' });
            }
            createSquad(body.name, body.protocols);
            return listSquads();
        });

        r.patch('/api/squads/:id', async (req, reply) => {
            const { id } = idParam.parse(req.params);
            const body = squadBody.partial().parse(req.body);
            if (!getSquad(id)) return reply.code(404).send({ error: 'Squad not found' });
            if (body.name && listSquads().some((sq) => sq.id !== id && sq.name.toLowerCase() === body.name!.toLowerCase())) {
                return reply.code(409).send({ error: 'Squad name already exists' });
            }
            updateSquad(id, body);
            return listSquads();
        });

        r.delete('/api/squads/:id', async (req) => {
            const { id } = idParam.parse(req.params);
            deleteSquad(id);
            return { ok: true };
        });

        r.delete('/api/users/:id', async (req) => {
            const { id } = idParam.parse(req.params);
            deleteUser(id);
            return { ok: true };
        });

        r.post('/api/users/:id/:action', async (req, reply) => {
            const { id, action } = z
                .object({ id: z.coerce.number().int(), action: z.enum(['reset', 'revoke', 'enable', 'disable']) })
                .parse(req.params);
            if (!getUser(id)) return reply.code(404).send({ error: 'User not found' });
            switch (action) {
                case 'reset':
                    return userDto(resetTraffic(id));
                case 'revoke':
                    return userDto(revokeUser(id));
                case 'enable':
                    return userDto(setStatus(id, 'ACTIVE'));
                case 'disable':
                    return userDto(setStatus(id, 'DISABLED'));
            }
        });

        r.delete('/api/users/:id/devices', async (req) => {
            const { id } = idParam.parse(req.params);
            deleteDevice(id);
            return { ok: true };
        });

        r.delete('/api/users/:id/devices/:deviceId', async (req) => {
            const { id, deviceId } = z.object({ id: z.coerce.number().int(), deviceId: z.coerce.number().int() }).parse(req.params);
            deleteDevice(id, deviceId);
            return { ok: true };
        });

        r.delete('/api/users/:id/connections', async (req) => {
            const { id } = idParam.parse(req.params);
            clearUserConnections(id);
            return { ok: true };
        });

        r.delete('/api/system/connections', async () => {
            clearAllConnections();
            return { ok: true };
        });

        r.get('/api/settings', async () => settingsDto());

        r.patch('/api/settings', async (req) => {
            const body = settingsPatch.parse(req.body);
            updateSettings(body as never);
            bus.emitEvent('settings:changed');
            return settingsDto();
        });

        r.post('/api/settings/regenerate/:what', async (req) => {
            const { what } = z.object({ what: z.enum(['reality', 'wireguard', 'amneziawg', 'paths']) }).parse(req.params);
            if (what === 'reality') {
                const k = realityKeyPair();
                updateSettings({ protocols: { 'vless-reality': { privateKey: k.privateKey, publicKey: k.publicKey } } });
            } else if (what === 'wireguard' || what === 'amneziawg') {
                const k = wgKeyPair();
                updateSettings({ protocols: { [what]: { privateKey: k.privateKey, publicKey: k.publicKey } } });
            } else {
                updateSettings({
                    protocols: {
                        'vless-xhttp': { path: `/${randomString(12).toLowerCase()}` },
                        'trojan-ws': { path: `/${randomString(12).toLowerCase()}` },
                    },
                });
            }
            bus.emitEvent('settings:changed');
            return settingsDto();
        });

        r.get('/api/system/cores', async () => ({
            xray: { running: xray.running, version: xray.version, uptime: xray.uptime, logs: xray.logs.get().slice(-200) },
            openvpn: { running: openvpn.running, version: openvpn.version, uptime: openvpn.uptime, logs: openvpn.logs.slice(-200) },
            wireguard: { running: wireguard.running, version: wireguard.engine ?? undefined, uptime: wireguard.uptime, logs: wireguard.logs.slice(-200) },
            amneziawg: { running: amneziawg.running, version: amneziawg.engine ?? undefined, uptime: amneziawg.uptime, logs: amneziawg.logs.slice(-200) },
            caddy: { ...caddyStatus(), caddyfile: buildCaddyfile() },
        }));

        r.get('/api/system/xray/config', async () => xray.writeConfig());

        r.post('/api/system/:core/restart', async (req) => {
            const { core } = z.object({ core: z.enum(['xray', 'openvpn', 'caddy', 'wireguard', 'amneziawg']) }).parse(req.params);
            if (core === 'xray') await xray.restart();
            if (core === 'wireguard') await wireguard.restart();
            if (core === 'amneziawg') await amneziawg.restart();
            if (core === 'openvpn') await openvpn.restart();
            if (core === 'caddy') return applyCaddy(true);
            return { ok: true };
        });

        r.get('/api/tokens', async () =>
            all<{ id: number; name: string; created_at: number }>('SELECT id, name, created_at FROM api_tokens ORDER BY id'),
        );

        r.post('/api/tokens', async (req) => {
            const { name } = z.object({ name: z.string().min(1).max(64) }).parse(req.body);
            const token = `brp_${randomString(40)}`;
            run('INSERT INTO api_tokens (name, token_hash, created_at) VALUES (?, ?, ?)', name, sha256(token), Date.now());
            return { token };
        });

        r.delete('/api/tokens/:id', async (req) => {
            const { id } = idParam.parse(req.params);
            run('DELETE FROM api_tokens WHERE id = ?', id);
            return { ok: true };
        });
    });
}
