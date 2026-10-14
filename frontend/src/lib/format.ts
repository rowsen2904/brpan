import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

export function bytes(value: number | null | undefined, digits = 2): string {
    const v = value ?? 0;
    if (v < 1024) return `${v} B`;
    const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
    let n = v / 1024;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(n >= 100 ? 0 : digits)} ${units[i]}`;
}

export function rate(bytesPerSec: number): string {
    const bits = bytesPerSec * 8;
    const units = ['bit/s', 'Kbit/s', 'Mbit/s', 'Gbit/s'];
    let n = bits;
    let i = 0;
    while (n >= 1000 && i < units.length - 1) {
        n /= 1000;
        i++;
    }
    return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function date(ts: number | null | undefined, withTime = true): string {
    if (!ts) return '—';
    return dayjs(ts).format(withTime ? 'DD.MM.YYYY HH:mm' : 'DD.MM.YYYY');
}

export function fromNow(ts: number | null | undefined): string {
    if (!ts) return 'never';
    return dayjs(ts).fromNow();
}

export function duration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
}

export const GB = 1024 ** 3;

export function daysLeft(ts: number | null): number | null {
    if (!ts) return null;
    return Math.ceil((ts - Date.now()) / 86_400_000);
}
