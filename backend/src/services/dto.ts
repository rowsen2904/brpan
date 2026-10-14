import { wgClientIp } from '../lib/net.js';
import type { UserRow } from '../types.js';
import { getSettings } from './settings.js';
import { subscriptionUrl } from './subscription.js';
import { parseProtocols } from './users.js';

export function userDto(u: UserRow, squadIds: number[] = []) {
    const s = getSettings();
    return {
        id: u.id,
        username: u.username,
        uuid: u.uuid,
        shortId: u.short_id,
        status: u.status,
        protocols: parseProtocols(u),
        squadIds,
        trafficLimit: u.traffic_limit,
        trafficUsed: u.traffic_used,
        lifetimeUsed: u.lifetime_used,
        resetStrategy: u.reset_strategy,
        lastResetAt: u.last_reset_at,
        expireAt: u.expire_at,
        deviceLimit: u.device_limit,
        note: u.note,
        telegramId: u.telegram_id,
        email: u.email,
        onlineAt: u.online_at,
        subUpdatedAt: u.sub_updated_at,
        subUserAgent: u.sub_user_agent,
        blockedUntil: u.blocked_until,
        wgIp: wgClientIp(s.protocols.wireguard.subnet, u.wg_index),
        subscriptionUrl: subscriptionUrl(u, s),
        createdAt: u.created_at,
        updatedAt: u.updated_at,
    };
}
