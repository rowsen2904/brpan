import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function randomString(length: number, alphabet = ALPHABET): string {
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
}

export function randomHex(bytes: number): string {
    return crypto.randomBytes(bytes).toString('hex');
}

export function uuid(): string {
    return crypto.randomUUID();
}

export function b64urlToStd(value: string): string {
    return Buffer.from(value, 'base64url').toString('base64');
}

export function wgKeyPair(): { privateKey: string; publicKey: string } {
    const raw = crypto.randomBytes(32);
    raw[0] &= 248;
    raw[31] = (raw[31] & 127) | 64;
    const d = raw.toString('base64url');
    const x = x25519PublicFromPrivateRaw(d);
    return { privateKey: raw.toString('base64'), publicKey: b64urlToStd(x) };
}

function x25519PublicFromPrivateRaw(d: string): string {
    const pkcs8 = Buffer.concat([
        Buffer.from('302e020100300506032b656e04220420', 'hex'),
        Buffer.from(d, 'base64url'),
    ]);
    const key = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
    return crypto.createPublicKey(key).export({ format: 'jwk' }).x!;
}

export function realityKeyPair(): { privateKey: string; publicKey: string } {
    const raw = crypto.randomBytes(32);
    raw[0] &= 248;
    raw[31] = (raw[31] & 127) | 64;
    const d = raw.toString('base64url');
    return { privateKey: d, publicKey: x25519PublicFromPrivateRaw(d) };
}

export function realityPublicKey(privateKey: string): string {
    return x25519PublicFromPrivateRaw(privateKey);
}

export function hashPassword(password: string): string {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 32);
    return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
    const [algo, saltB64, hashB64] = stored.split('$');
    if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
    return crypto.timingSafeEqual(expected, actual);
}

export function sha256(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

export function signJwt(payload: Record<string, unknown>, secret: string, ttlSec: number): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const body = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + ttlSec })).toString(
        'base64url',
    );
    const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
}

export function verifyJwt<T = Record<string, unknown>>(token: string, secret: string): T | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest();
    const actual = Buffer.from(sig, 'base64url');
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
        return payload as T;
    } catch {
        return null;
    }
}
