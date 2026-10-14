import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { config } from '../config.js';
import { all } from '../db.js';
import { AsyncLock } from '../lib/lock.js';
import { ensureNat, sh } from '../lib/nat.js';
import { parseCidr, serverIp, wgClientIp } from '../lib/net.js';
import type { Settings, UserRow } from '../types.js';
import { getSettings } from './settings.js';
import { addProtocolTraffic, addUserTraffic, enforceLimits, touchIp } from './stats.js';
import { allUsers, hasProtocol, isActive } from './users.js';

type Kind = 'wireguard' | 'amneziawg';

function awgParams(s: Settings, kind: Kind): string[] {
    if (kind !== 'amneziawg') return [];
    const a = s.protocols.amneziawg;
    return [`Jc = ${a.jc}`, `Jmin = ${a.jmin}`, `Jmax = ${a.jmax}`, `S1 = ${a.s1}`, `S2 = ${a.s2}`, `H1 = ${a.h1}`, `H2 = ${a.h2}`, `H3 = ${a.h3}`, `H4 = ${a.h4}`];
}

export class WgService {
    private proc: ChildProcess | null = null;
    private stopping = false;
    private restartTimer: NodeJS.Timeout | null = null;
    private counters = new Map<string, { rx: number; tx: number }>();
    private startedAt: number | null = null;
    private up = false;
    private mode: 'kernel' | 'userspace' | null = null;
    private readonly lock = new AsyncLock();
    logs: string[] = [];

    constructor(
        readonly kind: Kind,
        readonly iface: string,
    ) {}

    get running() {
        if (!this.up) return false;
        return this.mode === 'kernel' || (this.proc !== null && this.proc.exitCode === null);
    }

    get engine() {
        return this.mode;
    }

    private get tool() {
        return this.mode === 'kernel' && this.kind === 'wireguard' ? config.wgToolBin : config.awgToolBin;
    }

    private async tryKernel(): Promise<boolean> {
        const type = this.kind === 'wireguard' ? 'wireguard' : 'amneziawg';
        try {
            await sh('ip', ['link', 'add', this.iface, 'type', type]);
            this.mode = 'kernel';
            this.log(`[panel] using kernel ${type} module`);
            return true;
        } catch {
            return false;
        }
    }

    private async startUserspace() {
        this.mode = 'userspace';
        const proc = spawn(config.awgBin, ['-f', this.iface], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, LOG_LEVEL: 'error' },
        });
        this.proc = proc;
        proc.stdout?.on('data', (d) => this.log(String(d)));
        proc.stderr?.on('data', (d) => this.log(String(d)));
        proc.on('error', (e) => this.log(`[panel] ${this.kind} spawn error: ${e.message}`));
        proc.on('exit', (code) => {
            this.log(`[panel] ${this.kind} exited with code ${code}`);
            if (this.proc === proc) {
                this.proc = null;
                this.up = false;
                this.startedAt = null;
            }
            if (!this.stopping && this.cfg.enabled) this.scheduleRestart(5000);
        });
        await this.waitSocket();
        this.log(`[panel] using userspace amneziawg-go`);
    }

    get uptime() {
        return this.startedAt ? Date.now() - this.startedAt : 0;
    }

    private get cfg() {
        return getSettings().protocols[this.kind];
    }

    private log(line: string) {
        for (const l of line.split('\n')) {
            if (!l.trim()) continue;
            this.logs.push(l);
            if (this.logs.length > 300) this.logs.shift();
        }
    }

    private peerLines(user: UserRow) {
        return ['[Peer]', `PublicKey = ${user.wg_public_key}`, `AllowedIPs = ${wgClientIp(this.cfg.subnet, user.wg_index)}/32`];
    }

    private serverConf(): string {
        const s = getSettings();
        const lines = ['[Interface]', `PrivateKey = ${this.cfg.privateKey}`, `ListenPort = ${this.cfg.port}`, ...awgParams(s, this.kind), ''];
        for (const user of allUsers()) {
            if (isActive(user) && hasProtocol(user, this.kind)) lines.push(...this.peerLines(user), '');
        }
        return lines.join('\n');
    }

    clientConfig(user: UserRow): string {
        const s = getSettings();
        const c = this.cfg;
        const host = s.serverAddress || s.domain;
        return [
            '[Interface]',
            `PrivateKey = ${user.wg_private_key}`,
            `Address = ${wgClientIp(c.subnet, user.wg_index)}/32`,
            `DNS = ${c.dns}`,
            `MTU = ${c.mtu}`,
            ...awgParams(s, this.kind),
            '',
            '[Peer]',
            `PublicKey = ${c.publicKey}`,
            'AllowedIPs = 0.0.0.0/0, ::/0',
            `Endpoint = ${host.includes(':') ? `[${host}]` : host}:${c.port}`,
            'PersistentKeepalive = 25',
            '',
        ].join('\n');
    }

    private async waitSocket() {
        const sock = path.join('/var/run/amneziawg', `${this.iface}.sock`);
        for (let i = 0; i < 50; i++) {
            if (fs.existsSync(sock)) return;
            await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error(`UAPI socket ${sock} did not appear`);
    }

    start() {
        return this.lock.run(() => this.doStart());
    }

    stop() {
        return this.lock.run(() => this.doStop());
    }

    restart() {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        return this.lock.run(async () => {
            await this.doStop();
            await this.doStart();
        });
    }

    private async doStart() {
        if (config.disableCores || os.platform() !== 'linux' || this.running) return;
        if (!this.cfg.enabled) return;
        this.stopping = false;
        this.counters.clear();
        try {
            await sh('ip', ['link', 'del', this.iface]).catch(() => undefined);
            if (!(await this.tryKernel())) await this.startUserspace();
            const confPath = path.join(config.dataDir, `${this.iface}.conf`);
            fs.writeFileSync(confPath, this.serverConf(), { mode: 0o600 });
            await sh(this.tool, ['setconf', this.iface, confPath]);
            const { prefix } = parseCidr(this.cfg.subnet);
            await sh('ip', ['address', 'replace', `${serverIp(this.cfg.subnet)}/${prefix}`, 'dev', this.iface]);
            await sh('ip', ['link', 'set', 'mtu', String(this.cfg.mtu), 'up', 'dev', this.iface]);
            await ensureNat(this.iface, this.cfg.subnet, (m) => this.log(m));
            this.up = true;
            this.startedAt = Date.now();
        } catch (e) {
            this.log(`[panel] ${this.kind} start failed: ${(e as Error).message}`);
            await this.doStop();
            this.stopping = false;
            this.scheduleRestart(15000);
        }
    }

    private async doStop() {
        this.stopping = true;
        this.up = false;
        const proc = this.proc;
        this.proc = null;
        this.startedAt = null;
        if (!proc || proc.exitCode !== null) {
            if (this.mode === 'kernel') await sh('ip', ['link', 'del', this.iface]).catch(() => undefined);
            return;
        }
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                proc.kill('SIGKILL');
                resolve();
            }, 4000);
            proc.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
            proc.kill('SIGTERM');
        });
        await sh('ip', ['link', 'del', this.iface]).catch(() => undefined);
    }

    scheduleRestart(delay = 1000) {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            if (this.cfg.enabled) this.restart().catch((e) => this.log(`[panel] restart failed: ${e.message}`));
        }, delay);
    }

    async removePeer(publicKey: string) {
        if (!this.running) return;
        await sh(this.tool, ['set', this.iface, 'peer', publicKey, 'remove']).catch(() => undefined);
        this.counters.delete(publicKey);
    }

    async syncUser(user: UserRow, previousPublicKey?: string) {
        if (!this.running) return;
        if (previousPublicKey && previousPublicKey !== user.wg_public_key) await this.removePeer(previousPublicKey);
        if (!isActive(user) || !hasProtocol(user, this.kind)) {
            await this.removePeer(user.wg_public_key);
            return;
        }
        try {
            await sh(this.tool, [
                'set',
                this.iface,
                'peer',
                user.wg_public_key,
                'allowed-ips',
                `${wgClientIp(this.cfg.subnet, user.wg_index)}/32`,
            ]);
        } catch (e) {
            this.log(`[panel] add peer failed: ${(e as Error).message}`);
            this.scheduleRestart();
        }
    }

    async collect() {
        if (!this.running) return;
        let dump: string;
        try {
            dump = await sh(this.tool, ['show', this.iface, 'dump']);
        } catch {
            return;
        }
        const byKey = new Map(
            all<{ id: number; wg_public_key: string }>('SELECT id, wg_public_key FROM users').map((u) => [u.wg_public_key, u.id]),
        );
        const now = Date.now();
        const touched = new Set<number>();
        let up = 0;
        let down = 0;
        for (const line of dump.trim().split('\n').slice(1)) {
            const [pub, , endpoint, , handshake, rxStr, txStr] = line.split('\t');
            if (!pub) continue;
            const rx = Number(rxStr);
            const tx = Number(txStr);
            const prev = this.counters.get(pub);
            const dRx = prev && rx >= prev.rx ? rx - prev.rx : rx;
            const dTx = prev && tx >= prev.tx ? tx - prev.tx : tx;
            this.counters.set(pub, { rx, tx });
            const id = byKey.get(pub);
            if (!id) continue;
            if (dRx + dTx > 0) {
                addUserTraffic(id, dRx, dTx, now);
                touched.add(id);
                up += dRx;
                down += dTx;
            }
            const hs = Number(handshake) * 1000;
            if (endpoint && endpoint !== '(none)' && now - hs < 180_000) {
                touchIp(id, endpoint.replace(/:\d+$/, '').replace(/^\[|\]$/g, ''), this.kind, now);
            }
        }
        addProtocolTraffic(this.kind, up, down, now);
        enforceLimits(touched);
    }
}

export const wireguard = new WgService('wireguard', 'brpan-wg');
export const amneziawg = new WgService('amneziawg', 'brpan-awg');
export const wgServices = [wireguard, amneziawg];
