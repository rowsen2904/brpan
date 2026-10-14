import { EventEmitter } from 'node:events';

import type { UserRow } from '../types.js';

interface Events {
    'user:changed': [user: UserRow];
    'user:deleted': [user: UserRow];
    'users:bulk': [];
    'settings:changed': [];
}

class Bus extends EventEmitter {
    emitEvent<K extends keyof Events>(event: K, ...args: Events[K]) {
        return this.emit(event, ...args);
    }

    onEvent<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void) {
        return this.on(event, listener as (...args: unknown[]) => void);
    }
}

export const bus = new Bus();
bus.setMaxListeners(50);
