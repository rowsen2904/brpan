import { getSettings, updateSettings } from './settings.js';

const SOURCES: { url: string; parse: (body: string) => string | undefined }[] = [
    { url: 'https://ipinfo.io/country', parse: (b) => b.trim() },
    { url: 'https://api.country.is/', parse: (b) => (JSON.parse(b) as { country?: string }).country },
    { url: 'http://ip-api.com/line/?fields=countryCode', parse: (b) => b.trim() },
];

export async function detectCountry(): Promise<string | null> {
    for (const source of SOURCES) {
        try {
            const res = await fetch(source.url, { signal: AbortSignal.timeout(4000) });
            if (!res.ok) continue;
            const code = source.parse(await res.text());
            if (code && /^[A-Za-z]{2}$/.test(code)) return code.toUpperCase();
        } catch {
            continue;
        }
    }
    return null;
}

let detecting = false;

// Empty country means "auto": resolve the server's public IP country once and store it.
export async function autoDetectCountry() {
    if (detecting || getSettings().country) return;
    detecting = true;
    try {
        const code = await detectCountry();
        if (code && !getSettings().country) updateSettings({ country: code });
    } finally {
        detecting = false;
    }
}
