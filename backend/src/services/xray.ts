import { type ChildProcess, execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { XtlsApi } from '@remnawave/xtls-sdk';

import { config } from '../config.js';
import { XRAY_PROTOCOLS, type Protocol, type UserRow } from '../types.js';
import { getSettings } from './settings.js';
import { allUsers, hasProtocol, isActive } from './users.js';
import { buildXrayConfig, type TlsFiles } from './xray-config.js';

const execFileAsync = promisify(execFile);

const SS_CIPHER: Record<string, number> = {
    'aes-128-gcm': 5,
    'aes-256-gcm': 6,
    'chacha20-ietf-poly1305': 7,
};

class LogBuffer {
    private lines: string[] = [];
    push(chunk: string) {
        for (const line of chunk.split('\n')) {
            if (!line.trim()) continue;
            this.lines.push(line);
            if (this.lines.length > 500) this.lines.shift();
        }
    }
    get() {
        return this.lines.slice();
    }
}

class XrayService {
    private proc: ChildProcess | null = null;
    private stopping = false;
    private restartTimer: NodeJS.Timeout | null = null;
    private startedAt: number | null = null;
    private certFingerprint: string | null = null;
    readonly logs = new LogBuffer();
    version = '';
    api = new XtlsApi({ connectionUrl: `127.0.0.1:${config.xrayApiPort}` });

    get configPath() {
        return path.join(config.dataDir, 'xray.json');
    }

    get running() {
        return this.proc !== null && this.proc.exitCode === null;
    }

    get uptime() {
        return this.startedAt ? Date.now() - this.startedAt : 0;
    }

    async detectVersion() {
        try {
            const { stdout } = await execFileAsync(config.xrayBin, ['version']);
            this.version = stdout.split('\n')[0]?.split(' ')[1] ?? '';
        } catch {
            this.version = '';
        }
        return this.version;
    }

    tlsFiles(): TlsFiles | null {
        const domain = getSettings().domain;
        if (domain) {
            const found = findCaddyCert(domain);
            if (found) return found;
        }
        const certFile = path.join(config.dataDir, 'tls', 'selfsigned.crt');
        const keyFile = path.join(config.dataDir, 'tls', 'selfsigned.key');
        return fs.existsSync(certFile) && fs.existsSync(keyFile) ? { certFile, keyFile } : null;
    }

    async ensureSelfSigned() {
        const dir = path.join(config.dataDir, 'tls');
        const certFile = path.join(dir, 'selfsigned.crt');
        if (fs.existsSync(certFile)) return;
        fs.mkdirSync(dir, { recursive: true });
        const name = getSettings().domain || 'www.bing.com';
        try {
            await execFileAsync(config.xrayBin, ['tls', 'cert', `--domain=${name}`, `--file=${path.join(dir, 'selfsigned')}`]);
        } catch (e) {
            this.logs.push(`[panel] self-signed cert generation failed: ${(e as Error).message}`);
        }
    }

    certInfo(): { pinSha256: string | null; selfSigned: boolean } {
        const tls = this.tlsFiles();
        if (!tls) return { pinSha256: null, selfSigned: true };
        const selfSigned = tls.certFile.includes(`${path.sep}tls${path.sep}selfsigned`);
        try {
            const cert = new crypto.X509Certificate(fs.readFileSync(tls.certFile));
            return { pinSha256: cert.fingerprint256.replaceAll(':', '').toLowerCase(), selfSigned };
        } catch {
            return { pinSha256: null, selfSigned };
        }
    }

    writeConfig() {
        const cfg = buildXrayConfig(getSettings(), allUsers(), this.tlsFiles());
        fs.writeFileSync(this.configPath, JSON.stringify(cfg, null, 2));
        return cfg;
    }

    async start() {
        if (config.disableCores) return;
        await this.ensureSelfSigned();
        await this.detectVersion();
        this.writeConfig();
        this.certFingerprint = this.currentCertFingerprint();
        this.stopping = false;
        const env = { ...process.env, ...(config.xrayAssetDir ? { XRAY_LOCATION_ASSET: config.xrayAssetDir } : {}) };
        const proc = spawn(config.xrayBin, ['run', '-c', this.configPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        this.proc = proc;
        this.startedAt = Date.now();
        proc.stdout?.on('data', (d) => this.logs.push(String(d)));
        proc.stderr?.on('data', (d) => this.logs.push(String(d)));
        proc.on('error', (err) => {
            this.logs.push(`[panel] xray spawn error: ${err.message}`);
        });
        proc.on('exit', (code) => {
            this.logs.push(`[panel] xray exited with code ${code}`);
            if (this.proc === proc) {
                this.proc = null;
                this.startedAt = null;
            }
            if (!this.stopping) this.scheduleRestart(3000);
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
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        await this.stop();
        await this.start();
    }

    scheduleRestart(delay = 1000) {
        if (config.disableCores) return;
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            this.restart().catch((e) => this.logs.push(`[panel] restart failed: ${e.message}`));
        }, delay);
    }

    private currentCertFingerprint(): string | null {
        const tls = this.tlsFiles();
        if (!tls) return null;
        try {
            const stat = fs.statSync(tls.certFile);
            return `${tls.certFile}:${stat.mtimeMs}`;
        } catch {
            return null;
        }
    }

    checkCertChanged() {
        if (!this.running) return;
        if (this.currentCertFingerprint() !== this.certFingerprint) this.scheduleRestart();
    }

    private async addToInbound(protocol: Protocol, user: UserRow) {
        const s = getSettings();
        const tag = protocol;
        const username = String(user.id);
        const h = this.api.handler;
        switch (protocol) {
            case 'vless-reality':
                return h.addVlessUser({ tag, username, uuid: user.uuid, flow: 'xtls-rprx-vision', level: 0 });
            case 'vless-xhttp':
                return h.addVlessUser({ tag, username, uuid: user.uuid, flow: '', level: 0 });
            case 'trojan-ws':
                return h.addTrojanUser({ tag, username, password: user.trojan_password, level: 0 });
            case 'shadowsocks':
                return h.addShadowsocksUser({
                    tag,
                    username,
                    password: user.ss_password,
                    cipherType: SS_CIPHER[s.protocols.shadowsocks.method] as never,
                    ivCheck: false,
                    level: 0,
                });
            case 'hysteria2':
                return h.addHysteriaUser({ tag, username, uuid: user.uuid, level: 0 });
        }
    }

    private enabledTags(): Protocol[] {
        const s = getSettings();
        const hasTls = this.tlsFiles() !== null;
        return XRAY_PROTOCOLS.filter((p) => s.protocols[p].enabled && (p !== 'hysteria2' || hasTls));
    }

    async removeUser(user: UserRow) {
        if (!this.running) return;
        for (const tag of this.enabledTags()) {
            await this.api.handler.removeUser(tag, String(user.id)).catch(() => undefined);
        }
    }

    async syncUser(user: UserRow) {
        if (!this.running) return;
        try {
            for (const tag of this.enabledTags()) {
                await this.api.handler.removeUser(tag, String(user.id)).catch(() => undefined);
                if (!isActive(user) || !hasProtocol(user, tag)) continue;
                const res = await this.addToInbound(tag, user);
                if (res && !res.isOk) throw new Error(res.message ?? 'add user failed');
            }
        } catch (e) {
            this.logs.push(`[panel] live sync failed for user ${user.id}: ${(e as Error).message}, restarting`);
            this.scheduleRestart();
        }
    }
}

function findCaddyCert(domain: string): TlsFiles | null {
    const base = config.caddyCertDir;
    if (!fs.existsSync(base)) return null;
    for (const issuer of fs.readdirSync(base)) {
        const dir = path.join(base, issuer, domain);
        const certFile = path.join(dir, `${domain}.crt`);
        const keyFile = path.join(dir, `${domain}.key`);
        if (fs.existsSync(certFile) && fs.existsSync(keyFile)) return { certFile, keyFile };
    }
    return null;
}

export const xray = new XrayService();
