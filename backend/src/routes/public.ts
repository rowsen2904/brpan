import fs from 'node:fs';
import path from 'node:path';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../config.js';
import { openvpn } from '../services/openvpn.js';
import { getSettings } from '../services/settings.js';
import {
    buildSubscription,
    detectFormat,
    outlineResponse,
    publicInfo,
    type SubFormat,
    type SubResponse,
    wireguardResponse,
} from '../services/subscription.js';
import { getUserByShortId, hasProtocol, isActive } from '../services/users.js';

function send(reply: FastifyReply, res: SubResponse) {
    return reply.code(res.status).headers(res.headers).send(res.body);
}

export function sendIndex(reply: FastifyReply) {
    const index = path.join(config.staticDir, 'index.html');
    if (!fs.existsSync(index)) return reply.code(404).send('Frontend is not built');
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(fs.readFileSync(index));
}

export async function publicRoutes(app: FastifyInstance) {
    const handler = async (req: FastifyRequest, reply: FastifyReply) => {
        const { token, format } = req.params as { token: string; format?: string };
        const user = getUserByShortId(token);
        const ua = String(req.headers['user-agent'] ?? '');
        const accept = String(req.headers.accept ?? '');
        const query = req.query as { format?: string };
        const requested = (format ?? query.format ?? '').toLowerCase();

        if (!user) {
            if (detectFormat(ua, accept) === 'html' && !format) return sendIndex(reply);
            return reply.code(404).send('Not found');
        }

        switch (requested) {
            case 'info':
                return publicInfo(user);
            case 'outline':
                return send(reply, outlineResponse(user));
            case 'wireguard.conf':
            case 'wireguard':
                return send(reply, wireguardResponse(user, 'wireguard'));
            case 'amneziawg.conf':
            case 'amneziawg':
                return send(reply, wireguardResponse(user, 'amneziawg'));
            case 'openvpn.ovpn':
            case 'openvpn': {
                if (!isActive(user) || !hasProtocol(user, 'openvpn') || !getSettings().protocols.openvpn.enabled) {
                    return reply.code(403).send('OpenVPN is not available');
                }
                const profile = await openvpn.clientProfile(user);
                return reply
                    .header('content-type', 'application/x-openvpn-profile')
                    .header('content-disposition', `attachment; filename="${user.username.replace(/[^\w-]/g, '_')}.ovpn"`)
                    .send(profile);
            }
        }

        const map: Record<string, SubFormat> = {
            clash: 'clash',
            mihomo: 'clash',
            singbox: 'singbox',
            'sing-box': 'singbox',
            base64: 'base64',
            v2ray: 'base64',
            plain: 'plain',
            raw: 'plain',
        };
        const fmt = map[requested] ?? detectFormat(ua, accept);
        if (fmt === 'html') return sendIndex(reply);
        return send(
            reply,
            buildSubscription(user, fmt, { userAgent: ua, accept, headers: req.headers as Record<string, string | string[] | undefined> }),
        );
    };

    app.get('/sub/:token', handler);
    app.get('/sub/:token/:format', handler);

    app.get('/internal/openvpn/connect', async (req, reply) => {
        const q = req.query as Record<string, string>;
        if (req.headers['x-forwarded-for'] || q.token !== openvpn.hookToken) return reply.code(403).send('forbidden');
        return openvpn.authorizeConnect(q.cn ?? '', q.serial ?? '') ? 'ok' : reply.code(403).send('denied');
    });
}
