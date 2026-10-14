export function ipToInt(ip: string): number {
    return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

export function intToIp(n: number): string {
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function parseCidr(cidr: string): { network: number; prefix: number; size: number } {
    const [ip, prefixStr] = cidr.split('/');
    const prefix = Number(prefixStr);
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return { network: (ipToInt(ip) & mask) >>> 0, prefix, size: 2 ** (32 - prefix) };
}

export function cidrMask(prefix: number): string {
    return intToIp(prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0);
}

export function serverIp(cidr: string): string {
    return intToIp(parseCidr(cidr).network + 1);
}

export function wgClientIp(cidr: string, index: number): string {
    return intToIp(parseCidr(cidr).network + 1 + index);
}
