import fs from 'node:fs';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { ZodError } from 'zod';

import { ensureAdmin } from './auth.js';
import { config } from './config.js';
import { bus } from './lib/bus.js';
import { apiRoutes } from './routes/api.js';
import { publicRoutes, sendIndex } from './routes/public.js';
import { applyCaddy, caddyStatus } from './services/caddy.js';
import { flushConnections } from './services/conntrack.js';
import { openvpn } from './services/openvpn.js';
import { getSettings } from './services/settings.js';
import { collectXrayStats, housekeeping } from './services/stats.js';
import { sampleSystem } from './services/system.js';
import { hasProtocol, isActive } from './services/users.js';
import { wgServices } from './services/wireguard.js';
import { xray } from './services/xray.js';

const app = Fastify({ trustProxy: true, logger: { level: process.env.LOG_LEVEL ?? 'warn' }, bodyLimit: 1024 * 1024 });

app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
        const issue = err.issues[0];
        return reply.code(400).send({ error: `${issue.path.join('.') || 'body'}: ${issue.message}` });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: (err as Error).message });
});

await app.register(apiRoutes);
await app.register(publicRoutes);

if (fs.existsSync(config.staticDir)) {
    await app.register(fastifyStatic, { root: config.staticDir, wildcard: false, index: false });
}

app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/internal/')) return sendIndex(reply);
    return reply.code(404).send({ error: 'Not found' });
});

ensureAdmin((msg) => console.log(`\n==============================\n${msg}\n==============================\n`));
const settings = getSettings();

bus.onEvent('user:changed', (user) => {
    void xray.syncUser(user);
    for (const wg of wgServices) void wg.syncUser(user);
    if (!isActive(user) || !hasProtocol(user, 'openvpn')) void openvpn.kickUser(user);
});

bus.onEvent('user:deleted', (user) => {
    void xray.removeUser(user);
    for (const wg of wgServices) void wg.removePeer(user.wg_public_key);
    void openvpn.kickUser(user);
});

const xraySig = (s = getSettings()) => JSON.stringify({ p: s.protocols, d: s.domain, a: s.serverAddress });
let settingsTimer: NodeJS.Timeout | null = null;
let ovpnSignature = JSON.stringify(settings.protocols.openvpn);
let xraySignature = xraySig(settings);
const wgSignatures = new Map(wgServices.map((w) => [w.kind, JSON.stringify(settings.protocols[w.kind])]));
bus.onEvent('settings:changed', () => {
    if (settingsTimer) clearTimeout(settingsTimer);
    settingsTimer = setTimeout(async () => {
        const s = getSettings();
        const nextXraySig = xraySig(s);
        if (nextXraySig !== xraySignature) {
            xraySignature = nextXraySig;
            await xray.restart().catch(() => undefined);
        }
        const sig = JSON.stringify(s.protocols.openvpn);
        if (sig !== ovpnSignature) {
            ovpnSignature = sig;
            if (s.protocols.openvpn.enabled) await openvpn.restart().catch(() => undefined);
            else await openvpn.stop();
        }
        for (const wg of wgServices) {
            const wsig = JSON.stringify(s.protocols[wg.kind]);
            if (wsig === wgSignatures.get(wg.kind)) continue;
            wgSignatures.set(wg.kind, wsig);
            if (s.protocols[wg.kind].enabled) await wg.restart().catch(() => undefined);
            else await wg.stop();
        }
        await applyCaddy();
    }, 500);
});

async function boot() {
    await xray.start().catch((e) => console.error('xray start failed', e));
    await openvpn.start().catch((e) => console.error('openvpn start failed', e));
    for (const wg of wgServices) await wg.start().catch((e) => console.error(`${wg.kind} start failed`, e));
    await applyCaddy();

    setInterval(() => {
        void collectXrayStats();
        void openvpn.collect();
        for (const wg of wgServices) void wg.collect();
        flushConnections();
    }, config.statsIntervalSec * 1000);
    setInterval(() => {
        try {
            housekeeping();
        } catch (e) {
            console.error('housekeeping failed', e);
        }
    }, 60_000);
    setInterval(sampleSystem, 5_000);
    setInterval(() => xray.checkCertChanged(), 30_000);
    setInterval(() => {
        if (!caddyStatus().applied) void applyCaddy();
    }, 30_000);
    housekeeping();
}

async function shutdown() {
    await Promise.allSettled([xray.stop(), openvpn.stop(), ...wgServices.map((w) => w.stop()), app.close()]);
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ host: config.host, port: config.port });
console.log(`BRPAN panel listening on ${config.host}:${config.port}`);
await boot();
