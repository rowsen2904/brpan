import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function sh(cmd: string, args: string[], input?: string): Promise<string> {
    if (input === undefined) {
        const { stdout } = await execFileAsync(cmd, args);
        return stdout;
    }
    return new Promise((resolve, reject) => {
        const child = execFile(cmd, args, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout);
        });
        child.stdin?.end(input);
    });
}

export function enableForwarding(): string | null {
    try {
        if (fs.readFileSync('/proc/sys/net/ipv4/ip_forward', 'utf8').trim() === '1') return null;
        fs.writeFileSync('/proc/sys/net/ipv4/ip_forward', '1');
        return null;
    } catch {
        return 'cannot enable ip_forward from container, run `sysctl -w net.ipv4.ip_forward=1` on the host';
    }
}

export async function ensureNat(iface: string, subnet: string, log: (msg: string) => void) {
    const warn = enableForwarding();
    if (warn) log(`[panel] ${warn}`);
    const gateway = subnet.split('/')[0].replace(/\d+$/, '1');
    const rules: [string, string, string[]][] = [
        ['nat', 'POSTROUTING', ['-s', subnet, '!', '-o', iface, '-j', 'MASQUERADE']],
        ['filter', 'FORWARD', ['-i', iface, '-j', 'ACCEPT']],
        ['filter', 'FORWARD', ['-o', iface, '-m', 'conntrack', '--ctstate', 'RELATED,ESTABLISHED', '-j', 'ACCEPT']],
        ['filter', 'FORWARD', ['-i', iface, '-d', '10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16', '-j', 'DROP']],
        ['filter', 'INPUT', ['-i', iface, '-d', gateway, '-j', 'DROP']],
    ];
    for (const [table, chain, spec] of rules) {
        try {
            await execFileAsync('iptables', ['-t', table, '-C', chain, ...spec]);
        } catch {
            try {
                await execFileAsync('iptables', ['-t', table, chain === 'POSTROUTING' ? '-A' : '-I', chain, ...spec]);
            } catch (e) {
                log(`[panel] iptables ${table}/${chain} failed: ${(e as Error).message}`);
            }
        }
    }
}
