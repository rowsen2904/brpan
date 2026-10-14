import { all, get, run, tx } from '../db.js';
import { PROTOCOLS, type Protocol } from '../types.js';
import { updateUser } from './users.js';

export interface SquadRow {
    id: number;
    name: string;
    protocols: string;
    created_at: number;
}

export function squadProtocols(squad: Pick<SquadRow, 'protocols'>): Protocol[] {
    try {
        const list = JSON.parse(squad.protocols) as string[];
        return PROTOCOLS.filter((p) => list.includes(p));
    } catch {
        return [];
    }
}

export function listSquads() {
    return all<SquadRow & { members: number }>(
        'SELECT s.*, (SELECT COUNT(*) FROM user_squads us WHERE us.squad_id = s.id) AS members FROM squads s ORDER BY s.id',
    ).map((s) => ({ id: s.id, name: s.name, protocols: squadProtocols(s), members: s.members, createdAt: s.created_at }));
}

export function getSquad(id: number) {
    return get<SquadRow>('SELECT * FROM squads WHERE id = ?', id);
}

export function ensureDefaultSquad() {
    if (get<{ c: number }>('SELECT COUNT(*) AS c FROM squads')!.c > 0) return;
    tx(() => {
        const res = run('INSERT INTO squads (name, protocols, created_at) VALUES (?, ?, ?)', 'Main', JSON.stringify(PROTOCOLS), Date.now());
        const mainId = Number(res.lastInsertRowid);
        // Existing users with the full protocol set join Main; narrower sets stay as custom.
        for (const u of all<{ id: number; protocols: string }>('SELECT id, protocols FROM users')) {
            let list: string[] = [];
            try {
                list = JSON.parse(u.protocols) as string[];
            } catch {
                list = [];
            }
            if (PROTOCOLS.every((p) => list.includes(p))) {
                run('INSERT OR IGNORE INTO user_squads (user_id, squad_id) VALUES (?, ?)', u.id, mainId);
            }
        }
    });
}

export function defaultSquadIds(): number[] {
    const main = get<{ id: number }>("SELECT id FROM squads WHERE name = 'Main'") ?? get<{ id: number }>('SELECT id FROM squads ORDER BY id LIMIT 1');
    return main ? [main.id] : [];
}

export function validSquadIds(ids: number[]): number[] {
    if (!ids.length) return [];
    const existing = new Set(all<{ id: number }>('SELECT id FROM squads').map((r) => r.id));
    return [...new Set(ids)].filter((id) => existing.has(id));
}

export function protocolsForSquads(ids: number[]): Protocol[] {
    const set = new Set<Protocol>();
    for (const id of ids) {
        const squad = getSquad(id);
        if (squad) for (const p of squadProtocols(squad)) set.add(p);
    }
    return PROTOCOLS.filter((p) => set.has(p));
}

export function userSquadIds(userId: number): number[] {
    return all<{ squad_id: number }>('SELECT squad_id FROM user_squads WHERE user_id = ? ORDER BY squad_id', userId).map((r) => r.squad_id);
}

export function squadIdsByUser(): Map<number, number[]> {
    const map = new Map<number, number[]>();
    for (const r of all<{ user_id: number; squad_id: number }>('SELECT user_id, squad_id FROM user_squads ORDER BY squad_id')) {
        const list = map.get(r.user_id) ?? [];
        list.push(r.squad_id);
        map.set(r.user_id, list);
    }
    return map;
}

export function setUserSquads(userId: number, ids: number[]) {
    tx(() => {
        run('DELETE FROM user_squads WHERE user_id = ?', userId);
        for (const id of ids) run('INSERT OR IGNORE INTO user_squads (user_id, squad_id) VALUES (?, ?)', userId, id);
    });
}

function membersOf(squadId: number): number[] {
    return all<{ user_id: number }>('SELECT user_id FROM user_squads WHERE squad_id = ?', squadId).map((r) => r.user_id);
}

function resyncMembers(userIds: number[]) {
    for (const userId of userIds) updateUser(userId, { protocols: protocolsForSquads(userSquadIds(userId)) });
}

export function createSquad(name: string, protocols: Protocol[]) {
    const res = run('INSERT INTO squads (name, protocols, created_at) VALUES (?, ?, ?)', name, JSON.stringify(protocols), Date.now());
    return getSquad(Number(res.lastInsertRowid))!;
}

export function updateSquad(id: number, patch: { name?: string; protocols?: Protocol[] }) {
    if (patch.name !== undefined) run('UPDATE squads SET name = ? WHERE id = ?', patch.name, id);
    if (patch.protocols !== undefined) {
        run('UPDATE squads SET protocols = ? WHERE id = ?', JSON.stringify(patch.protocols), id);
        resyncMembers(membersOf(id));
    }
    return getSquad(id);
}

export function deleteSquad(id: number) {
    const members = membersOf(id);
    run('DELETE FROM squads WHERE id = ?', id);
    resyncMembers(members);
}
