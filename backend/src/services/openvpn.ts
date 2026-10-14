import { type ChildProcess, execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';

import { config } from '../config.js';
import { get, run } from '../db.js';
import { randomHex } from '../lib/crypto.js';
import { ensureNat } from '../lib/nat.js';
import { cidrMask, parseCidr, intToIp } from '../lib/net.js';
import type { UserRow } from '../types.js';
import { serverAddress } from './links.js';
import { getSecret, getSettings } from './settings.js';
import { addProtocolTraffic, addUserTraffic, enforceLimits, touchIp } from './stats.js';
import { getUser, hasProtocol, isActive } from './users.js';

const execFileAsync = promisify(execFile);
const MGMT_PORT = 7505;
const DEV = 'brpan-ovpn';

interface ClientEntry {
    cid: string;
    cn: string;
    realAddr: string;
    recv: number;
    sent: number;
}

class OpenVpnService {
    private proc: ChildProcess | null = null;
    private stopping = false;
    private restartTimer: NodeJS.Timeout | null = null;
    private counters = new Map<string, { recv: number; sent: number }>();
    private startedAt: number | null = null;
    private lastClients: ClientEntry[] = [];
    logs: string[] = [];
    version = '';

    get dir() {
        return path.join(config.dataDir, 'openvpn');
    }

    get running() {
        return this.proc !== null && this.proc.exitCode === null;
    }

    get uptime() {
        return this.startedAt ? Date.now() - this.startedAt : 0;
    }

    get hookToken() {
        return getSecret('openvpn_hook_token', () => randomHex(24));
    }

    private log(line: string) {
        for (const l of line.split('\n')) {
            if (!l.trim()) continue;
            this.logs.push(l);
            if (this.logs.length > 300) this.logs.shift();
        }
    }

    private async openssl(args: string[]) {
        await execFileAsync(config.opensslBin, args, { cwd: this.dir });
    }

    async ensurePki() {
        fs.mkdirSync(path.join(this.dir, 'clients'), { recursive: true });
        const f = (n: string) => path.join(this.dir, n);
        const ec = ['-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes'];
        if (!fs.existsSync(f('ca.crt'))) {
            await this.openssl(['req', '-x509', ...ec, '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '3650', '-subj', '/CN=brpan-ca']);
        }
        if (!fs.existsSync(f('server.crt'))) {
            fs.writeFileSync(f('server.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyAgreement\nextendedKeyUsage=serverAuth\n');
            await this.openssl(['req', ...ec, '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=brpan-server']);
            await this.openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-set_serial', `0x${randomHex(8)}`, '-out', 'server.crt', '-days', '3650', '-extfile', 'server.ext']);
        }
        if (!fs.existsSync(f('tc.key'))) {
            fs.writeFileSync(f('tc.key'), openvpnStaticKey(), { mode: 0o600 });
        }
        fs.writeFileSync(f('client.ext'), 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=clientAuth\n');
    }

    async ensureClientCert(user: UserRow): Promise<{ cert: string; key: string }> {
        const base = path.join(this.dir, 'clients', String(user.id));
        if (user.ovpn_serial && fs.existsSync(`${base}.crt`) && fs.existsSync(`${base}.key`)) {
            return { cert: fs.readFileSync(`${base}.crt`, 'utf8'), key: fs.readFileSync(`${base}.key`, 'utf8') };
        }
        await this.ensurePki();
        if (!fs.existsSync(path.join(this.dir, 'ca.crt'))) throw new Error('OpenVPN PKI is not initialized');
        const serial = randomHex(8).replace(/^0+/, '') || '1';
        const rel = path.join('clients', String(user.id));
        await this.openssl(['req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', `${rel}.key`, '-out', `${rel}.csr`, '-subj', `/CN=${user.id}`]);
        await this.openssl(['x509', '-req', '-in', `${rel}.csr`, '-CA', 'ca.crt', '-CAkey', 'ca.key', '-set_serial', `0x${serial}`, '-out', `${rel}.crt`, '-days', '3650', '-extfile', 'client.ext']);
        fs.rmSync(`${base}.csr`, { force: true });
        run('UPDATE users SET ovpn_serial = ? WHERE id = ?', serial, user.id);
        return { cert: fs.readFileSync(`${base}.crt`, 'utf8'), key: fs.readFileSync(`${base}.key`, 'utf8') };
    }

    async clientProfile(user: UserRow): Promise<string> {
        const s = getSettings();
        const o = s.protocols.openvpn;
        const { cert, key } = await this.ensureClientCert(user);
        const ca = fs.readFileSync(path.join(this.dir, 'ca.crt'), 'utf8');
        const tc = fs.readFileSync(path.join(this.dir, 'tc.key'), 'utf8');
        return [
            'client',
            'dev tun',
            `proto ${o.proto}`,
            `remote ${serverAddress(s)} ${o.port}`,
            'resolv-retry infinite',
            'nobind',
            'persist-key',
            'persist-tun',
            'remote-cert-tls server',
            'mssfix 1360',
            'auth SHA256',
            'data-ciphers AES-128-GCM:AES-256-GCM:CHACHA20-POLY1305',
            'verb 3',
            `setenv PROFILE_NAME ${s.subscription.profileTitle.replace(/\s+/g, '_')}`,
            `<ca>\n${ca.trim()}\n</ca>`,
            `<cert>\n${cert.trim()}\n</cert>`,
            `<key>\n${key.trim()}\n</key>`,
            `<tls-crypt>\n${tc.trim()}\n</tls-crypt>`,
            '',
        ].join('\n');
    }

    private writeServerConfig() {
        const o = getSettings().protocols.openvpn;
        const { network, prefix } = parseCidr(o.subnet);
        const hook = path.join(this.dir, 'connect.sh');
        fs.writeFileSync(
            hook,
            [
                '#!/bin/sh',
                `curl -fsS -m 5 -o /dev/null "http://127.0.0.1:${config.port}/internal/openvpn/connect?token=${this.hookToken}&cn=$common_name&serial=$tls_serial_hex_0&ip=$trusted_ip"`,
                '',
            ].join('\n'),
            { mode: 0o755 },
        );
        const conf = [
            `port ${o.port}`,
            `proto ${o.proto}`,
            `dev ${DEV}`,
            'dev-type tun',
            'topology subnet',
            `server ${intToIp(network)} ${cidrMask(prefix)}`,
            'ca ca.crt',
            'cert server.crt',
            'key server.key',
            'dh none',
            'ecdh-curve prime256v1',
            'tls-crypt tc.key',
            'tls-version-min 1.2',
            'data-ciphers AES-128-GCM:AES-256-GCM:CHACHA20-POLY1305',
            'auth SHA256',
            'keepalive 10 60',
            'mssfix 1360',
            'txqueuelen 1000',
            'persist-key',
            'persist-tun',
            'duplicate-cn',
            'push "redirect-gateway def1 bypass-dhcp"',
            ...o.dns.split(',').map((d) => `push "dhcp-option DNS ${d.trim()}"`),
            `management 127.0.0.1 ${MGMT_PORT}`,
            'script-security 2',
            `client-connect ${hook}`,
            ...(o.proto === 'udp' ? ['explicit-exit-notify 1', 'fast-io'] : []),
            'verb 3',
        ];
        fs.writeFileSync(path.join(this.dir, 'server.conf'), conf.join('\n') + '\n');
    }

    private async setupNat() {
        await ensureNat(DEV, getSettings().protocols.openvpn.subnet, (m) => this.log(m));
    }

    async start() {
        if (config.disableCores) return;
        const s = getSettings();
        if (!s.protocols.openvpn.enabled) return;
        try {
            const { stdout } = await execFileAsync(config.openvpnBin, ['--version']).catch((e) => ({ stdout: String(e.stdout ?? '') }));
            this.version = stdout.split('\n')[0]?.split(' ')[1] ?? '';
            await this.ensurePki();
        } catch (e) {
            this.log(`[panel] openvpn init failed: ${(e as Error).message}`);
            return;
        }
        this.writeServerConfig();
        await this.setupNat();
        this.stopping = false;
        this.counters.clear();
        const proc = spawn(config.openvpnBin, ['--config', 'server.conf'], { cwd: this.dir, stdio: ['ignore', 'pipe', 'pipe'] });
        this.proc = proc;
        this.startedAt = Date.now();
        proc.stdout?.on('data', (d) => this.log(String(d)));
        proc.stderr?.on('data', (d) => this.log(String(d)));
        proc.on('error', (e) => this.log(`[panel] openvpn spawn error: ${e.message}`));
        proc.on('exit', (code) => {
            this.log(`[panel] openvpn exited with code ${code}`);
            if (this.proc === proc) {
                this.proc = null;
                this.startedAt = null;
            }
            if (!this.stopping && getSettings().protocols.openvpn.enabled) this.scheduleRestart(5000);
        });
    }

    async stop() {
        this.stopping = true;
        const proc = this.proc;
        if (!proc) return;
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                proc.kill('SIGKILL');
                resolve();
            }, 5000);
            proc.once('exit', () => {
                clearTimeout(timer);
                resolve();
            });
            proc.kill('SIGTERM');
        });
        this.proc = null;
    }

    async restart() {
        await this.stop();
        await this.start();
    }

    scheduleRestart(delay = 1000) {
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            this.restart().catch((e) => this.log(`[panel] openvpn restart failed: ${e.message}`));
        }, delay);
    }

    private management(command: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const sock = net.connect(MGMT_PORT, '127.0.0.1');
            let buf = '';
            const timer = setTimeout(() => {
                sock.destroy();
                reject(new Error('management timeout'));
            }, 4000);
            sock.on('data', (d) => {
                buf += String(d);
                if (/^END\r?$/m.test(buf) || /^(SUCCESS|ERROR):.*$/m.test(buf.split('\n').slice(1).join('\n'))) {
                    clearTimeout(timer);
                    sock.end('quit\n');
                    resolve(buf);
                }
            });
            sock.on('connect', () => sock.write(`${command}\n`));
            sock.on('error', (e) => {
                clearTimeout(timer);
                reject(e);
            });
        });
    }

    async clients(): Promise<ClientEntry[]> {
        const out = await this.management('status 3');
        const list: ClientEntry[] = [];
        for (const line of out.split('\n')) {
            const parts = line.trim().split('\t');
            if (parts[0] !== 'CLIENT_LIST' || parts.length < 11) continue;
            list.push({ cn: parts[1], realAddr: parts[2], recv: Number(parts[5]), sent: Number(parts[6]), cid: parts[10] });
        }
        return list;
    }

    async collect() {
        if (!this.running) return;
        let list: ClientEntry[];
        try {
            list = await this.clients();
        } catch {
            return;
        }
        this.lastClients = list;
        const now = Date.now();
        const seen = new Set<string>();
        const touched = new Set<number>();
        let up = 0;
        let down = 0;
        for (const c of list) {
            seen.add(c.cid);
            const prev = this.counters.get(c.cid) ?? { recv: 0, sent: 0 };
            const dUp = Math.max(0, c.recv - prev.recv);
            const dDown = Math.max(0, c.sent - prev.sent);
            this.counters.set(c.cid, { recv: c.recv, sent: c.sent });
            const id = Number(c.cn);
            if (!Number.isInteger(id) || !get('SELECT 1 FROM users WHERE id = ?', id)) {
                await this.kill(c.cid);
                continue;
            }
            addUserTraffic(id, dUp, dDown, now);
            touchIp(id, c.realAddr.split(':')[0], 'openvpn', now);
            up += dUp;
            down += dDown;
            touched.add(id);
            const user = getUser(id);
            if (!user || !isActive(user) || !hasProtocol(user, 'openvpn')) await this.kill(c.cid);
        }
        for (const cid of this.counters.keys()) if (!seen.has(cid)) this.counters.delete(cid);
        addProtocolTraffic('openvpn', up, down, now);
        enforceLimits(touched);
    }

    async kill(cid: string) {
        await this.management(`client-kill ${cid}`).catch(() => undefined);
    }

    async kickUser(user: UserRow) {
        if (!this.running) return;
        try {
            for (const c of await this.clients()) if (c.cn === String(user.id)) await this.kill(c.cid);
        } catch {
            return;
        }
    }

    authorizeConnect(cn: string, serialHex: string): boolean {
        const user = getUser(Number(cn));
        if (!user || !isActive(user) || !hasProtocol(user, 'openvpn')) return false;
        const serial = serialHex.replaceAll(':', '').toLowerCase().replace(/^0+/, '');
        if (!user.ovpn_serial || user.ovpn_serial.replace(/^0+/, '') !== serial) return false;
        if (user.device_limit > 0) {
            const current = this.lastClients.filter((c) => c.cn === cn).length;
            if (current >= user.device_limit) return false;
        }
        return true;
    }
}

function openvpnStaticKey(): string {
    const hex = crypto.randomBytes(256).toString('hex');
    const body = hex.match(/.{1,32}/g)!.join('\n');
    return `#\n# 2048 bit OpenVPN static key\n#\n-----BEGIN OpenVPN Static key V1-----\n${body}\n-----END OpenVPN Static key V1-----\n`;
}

export const openvpn = new OpenVpnService();
