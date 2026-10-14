const OFFSET = 127397;

export function countryFlag(code: string | null | undefined): string {
    if (!code || !/^[A-Za-z]{2}$/.test(code) || code.toUpperCase() === 'XX') return '';
    return String.fromCodePoint(...[...code.toUpperCase()].map((c) => (c.codePointAt(0) as number) + OFFSET));
}
