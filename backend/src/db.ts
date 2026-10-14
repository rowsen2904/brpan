import fs from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const migrations: string[] = [
    `
    CREATE TABLE admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        uuid TEXT NOT NULL UNIQUE,
        short_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        trojan_password TEXT NOT NULL,
        ss_password TEXT NOT NULL,
        wg_private_key TEXT NOT NULL,
        wg_public_key TEXT NOT NULL,
        wg_index INTEGER NOT NULL UNIQUE,
        ovpn_serial TEXT,
        protocols TEXT NOT NULL DEFAULT '[]',
        traffic_limit INTEGER NOT NULL DEFAULT 0,
        traffic_used INTEGER NOT NULL DEFAULT 0,
        lifetime_used INTEGER NOT NULL DEFAULT 0,
        reset_strategy TEXT NOT NULL DEFAULT 'NO_RESET',
        last_reset_at INTEGER,
        expire_at INTEGER,
        device_limit INTEGER NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        telegram_id TEXT,
        email TEXT,
        online_at INTEGER,
        sub_updated_at INTEGER,
        sub_user_agent TEXT,
        blocked_until INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX users_status_idx ON users(status);
    CREATE TABLE devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hwid TEXT NOT NULL,
        platform TEXT,
        os_version TEXT,
        model TEXT,
        user_agent TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, hwid)
    );
    CREATE TABLE user_usage (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hour INTEGER NOT NULL,
        up INTEGER NOT NULL DEFAULT 0,
        down INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, hour)
    );
    CREATE TABLE protocol_usage (
        protocol TEXT NOT NULL,
        hour INTEGER NOT NULL,
        up INTEGER NOT NULL DEFAULT 0,
        down INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (protocol, hour)
    );
    CREATE TABLE user_ips (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ip TEXT NOT NULL,
        protocol TEXT NOT NULL,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (user_id, ip)
    );
    CREATE TABLE api_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
    );
    `,
    `
    CREATE TABLE connection_log (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        host TEXT NOT NULL,
        protocol TEXT NOT NULL,
        hits INTEGER NOT NULL DEFAULT 0,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        PRIMARY KEY (user_id, host)
    );
    CREATE INDEX connection_log_last_idx ON connection_log(last_seen);
    CREATE INDEX connection_log_user_idx ON connection_log(user_id, last_seen);
    `,
];

function migrate() {
    db.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
    const applied = new Set(
        (db.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map((r) => r.id),
    );
    migrations.forEach((sql, i) => {
        if (applied.has(i)) return;
        tx(() => {
            db.exec(sql);
            db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(i, Date.now());
        });
    });
}

let txDepth = 0;

export function tx<T>(fn: () => T): T {
    if (txDepth > 0) return fn();
    txDepth++;
    db.exec('BEGIN');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (e) {
        db.exec('ROLLBACK');
        throw e;
    } finally {
        txDepth--;
    }
}

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return db.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return db.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
    return db.prepare(sql).run(...params);
}

migrate();
