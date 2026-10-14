import { notifications } from '@mantine/notifications';

const TOKEN_KEY = 'brpan_token';

export const auth = {
    get token() {
        try {
            return localStorage.getItem(TOKEN_KEY);
        } catch {
            return null;
        }
    },
    set(token: string | null) {
        try {
            if (token) localStorage.setItem(TOKEN_KEY, token);
            else localStorage.removeItem(TOKEN_KEY);
        } catch {
            /* storage unavailable */
        }
    },
};

export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown; silent?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (auth.token) headers.authorization = `Bearer ${auth.token}`;
    const res = await fetch(path, {
        method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (res.status === 401 && !path.endsWith('/login')) {
        auth.set(null);
        if (!location.pathname.startsWith('/login')) location.href = '/login';
        throw new ApiError('Unauthorized', 401);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
        const message = data?.error ?? res.statusText;
        if (!options.silent) notifications.show({ color: 'red', title: 'Error', message });
        throw new ApiError(message, res.status);
    }
    return data as T;
}

export function notifyOk(message: string) {
    notifications.show({ color: 'teal', message });
}
