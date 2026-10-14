import fs from 'node:fs';
import os from 'node:os';

import { config } from '../config.js';

let lastCpu = cpuTimes();
let cpuUsage = 0;
let lastNet = netBytes();
let lastNetAt = Date.now();
let netRate = { rx: 0, tx: 0 };

function cpuTimes() {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
        for (const v of Object.values(cpu.times)) total += v;
        idle += cpu.times.idle;
    }
    return { idle, total };
}

function netBytes(): { rx: number; tx: number } | null {
    try {
        const text = fs.readFileSync('/proc/net/dev', 'utf8');
        let rx = 0;
        let tx = 0;
        for (const line of text.split('\n').slice(2)) {
            const [iface, rest] = line.split(':');
            if (!rest) continue;
            const name = iface.trim();
            if (name === 'lo' || name.startsWith('docker') || name.startsWith('veth') || name.startsWith('br-')) continue;
            const parts = rest.trim().split(/\s+/).map(Number);
            rx += parts[0];
            tx += parts[8];
        }
        return { rx, tx };
    } catch {
        return null;
    }
}

export function sampleSystem() {
    const cpu = cpuTimes();
    const dTotal = cpu.total - lastCpu.total;
    if (dTotal > 0) cpuUsage = 1 - (cpu.idle - lastCpu.idle) / dTotal;
    lastCpu = cpu;
    const net = netBytes();
    const now = Date.now();
    if (net && lastNet) {
        const dt = (now - lastNetAt) / 1000;
        if (dt > 0) netRate = { rx: Math.max(0, (net.rx - lastNet.rx) / dt), tx: Math.max(0, (net.tx - lastNet.tx) / dt) };
    }
    lastNet = net;
    lastNetAt = now;
}

export function systemInfo() {
    let disk: { total: number; free: number } | null = null;
    try {
        const st = fs.statfsSync(config.dataDir);
        disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize };
    } catch {
        disk = null;
    }
    const net = lastNet;
    return {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        arch: os.arch(),
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model ?? '',
        cpuUsage,
        load: os.loadavg(),
        memory: { total: os.totalmem(), free: os.freemem() },
        disk,
        uptime: os.uptime(),
        net: { rate: netRate, total: net },
        node: process.version,
    };
}
