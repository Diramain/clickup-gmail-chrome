type StorageValues = Record<string, unknown>;
type StorageChanges = Record<string, chrome.storage.StorageChange>;
type StorageListener = (changes: StorageChanges, areaName: string) => void;

export interface PrivateStorageBackend {
    read(keys: string[] | null): Promise<StorageValues>;
    set(items: StorageValues): Promise<StorageMutation>;
    remove(keys: string[]): Promise<StorageMutation>;
    clear(): Promise<StorageMutation>;
}

interface StorageMutation {
    changes: StorageChanges;
    sequence: number;
}

function dictionary<T>(): Record<string, T> {
    return Object.create(null) as Record<string, T>;
}

function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
    Object.defineProperty(target, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
    });
}

function requestedKeys(keys?: string | string[] | object | null): string[] | null {
    if (keys === undefined || keys === null) return null;
    if (typeof keys === 'string') return [keys];
    if (Array.isArray(keys)) return keys;
    return Object.keys(keys);
}

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

export function createPrivateStorageArea(
    backend: PrivateStorageBackend,
    emitChanges: (mutation: StorageMutation) => void = () => undefined,
): chrome.storage.StorageArea {
    return {
        async get(keys?: string | string[] | object | null) {
            const values = await backend.read(requestedKeys(keys));
            if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return values;

            const defaults = keys as StorageValues;
            for (const [key, defaultValue] of Object.entries(defaults)) {
                if (!hasOwn(values, key)) setOwn(values, key, defaultValue);
            }
            return values;
        },
        async set(items: StorageValues) {
            if (Object.keys(items).length === 0) return;
            const mutation = await backend.set(items);
            if (Object.keys(mutation.changes).length > 0) emitChanges(mutation);
        },
        async remove(keys: string | string[]) {
            const mutation = await backend.remove(Array.isArray(keys) ? keys : [keys]);
            if (Object.keys(mutation.changes).length > 0) emitChanges(mutation);
        },
        async clear() {
            const mutation = await backend.clear();
            if (Object.keys(mutation.changes).length > 0) emitChanges(mutation);
        },
        async setAccessLevel(details: { accessLevel: string }) {
            if (details.accessLevel !== 'TRUSTED_CONTEXTS') {
                throw new Error('Private storage cannot be exposed to untrusted contexts');
            }
        },
    } as unknown as chrome.storage.StorageArea;
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('Private storage transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Private storage transaction aborted'));
    });
}

function createIndexedDbBackend(): PrivateStorageBackend {
    const SEQUENCE_KEY = 'sequence';
    let databasePromise: Promise<IDBDatabase> | null = null;
    const getDatabase = (): Promise<IDBDatabase> => {
        if (databasePromise) return databasePromise;
        databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
            let blocked = false;
            const request = indexedDB.open('taskbridge-private-storage', 2);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains('values')) {
                    request.result.createObjectStore('values');
                }
                if (!request.result.objectStoreNames.contains('metadata')) {
                    request.result.createObjectStore('metadata');
                }
            };
            request.onsuccess = () => {
                if (blocked) {
                    request.result.close();
                    return;
                }
                request.result.onversionchange = () => request.result.close();
                resolve(request.result);
            };
            request.onerror = () => reject(request.error ?? new Error('Private storage unavailable'));
            request.onblocked = () => {
                blocked = true;
                reject(new Error('Private storage upgrade blocked'));
            };
        }).catch((error: unknown) => {
            databasePromise = null;
            throw error;
        });
        return databasePromise;
    };

    const queueNextSequence = (transaction: IDBTransaction, assign: (sequence: number) => void): void => {
        const metadata = transaction.objectStore('metadata');
        const request = metadata.get(SEQUENCE_KEY);
        request.onsuccess = () => {
            const current = Number.isSafeInteger(request.result) ? Number(request.result) : 0;
            const next = current + 1;
            metadata.put(next, SEQUENCE_KEY);
            assign(next);
        };
        request.onerror = () => transaction.abort();
    };

    return {
        async read(keys) {
            const database = await getDatabase();
            const transaction = database.transaction('values', 'readonly');
            const done = transactionDone(transaction);
            const store = transaction.objectStore('values');
            const values = dictionary<unknown>();
            if (keys === null) {
                await new Promise<void>((resolve, reject) => {
                    const cursor = store.openCursor();
                    cursor.onsuccess = () => {
                        const result = cursor.result;
                        if (!result) {
                            resolve();
                            return;
                        }
                        setOwn(values, String(result.key), result.value);
                        result.continue();
                    };
                    cursor.onerror = () => reject(cursor.error ?? new Error('Private storage cursor failed'));
                });
            } else {
                await Promise.all(keys.map((key) => new Promise<void>((resolve, reject) => {
                    const request = store.get(key);
                    request.onsuccess = () => {
                        if (request.result !== undefined) setOwn(values, key, request.result);
                        resolve();
                    };
                    request.onerror = () => reject(request.error ?? new Error('Private storage read failed'));
                })));
            }
            await done;
            return values;
        },
        async set(items) {
            const database = await getDatabase();
            const transaction = database.transaction(['values', 'metadata'], 'readwrite');
            const done = transactionDone(transaction);
            const store = transaction.objectStore('values');
            const changes = dictionary<chrome.storage.StorageChange>();
            let sequence = 0;
            queueNextSequence(transaction, (next) => { sequence = next; });
            for (const [key, newValue] of Object.entries(items)) {
                const request = store.get(key);
                request.onsuccess = () => {
                    try {
                        store.put(newValue, key);
                        const change: chrome.storage.StorageChange = { newValue };
                        if (request.result !== undefined) change.oldValue = request.result;
                        setOwn(changes, key, change);
                    } catch {
                        transaction.abort();
                    }
                };
                request.onerror = () => transaction.abort();
            }
            await done;
            return { changes, sequence };
        },
        async remove(keys) {
            const database = await getDatabase();
            const transaction = database.transaction(['values', 'metadata'], 'readwrite');
            const done = transactionDone(transaction);
            const store = transaction.objectStore('values');
            const changes = dictionary<chrome.storage.StorageChange>();
            let sequence = 0;
            queueNextSequence(transaction, (next) => { sequence = next; });
            for (const key of keys) {
                const request = store.get(key);
                request.onsuccess = () => {
                    if (request.result !== undefined) {
                        setOwn(changes, key, { oldValue: request.result });
                        store.delete(key);
                    }
                };
                request.onerror = () => transaction.abort();
            }
            await done;
            return { changes, sequence };
        },
        async clear() {
            const database = await getDatabase();
            const transaction = database.transaction(['values', 'metadata'], 'readwrite');
            const done = transactionDone(transaction);
            const store = transaction.objectStore('values');
            const changes = dictionary<chrome.storage.StorageChange>();
            let sequence = 0;
            queueNextSequence(transaction, (next) => { sequence = next; });
            const cursor = store.openCursor();
            cursor.onsuccess = () => {
                const result = cursor.result;
                if (result) {
                    setOwn(changes, String(result.key), { oldValue: result.value });
                    result.continue();
                    return;
                }
                store.clear();
            };
            cursor.onerror = () => transaction.abort();
            await done;
            return { changes, sequence };
        },
    };
}

function createTrustedSessionArea(nativeArea: chrome.storage.StorageArea): chrome.storage.StorageArea {
    return new Proxy(nativeArea, {
        get(target, property) {
            if (property === 'setAccessLevel') {
                return async (details: { accessLevel: string }) => {
                    if (details.accessLevel !== 'TRUSTED_CONTEXTS') {
                        throw new Error('Session storage cannot be exposed to untrusted contexts');
                    }
                };
            }
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

function createDeniedStorageArea(): chrome.storage.StorageArea {
    const denied = async (): Promise<never> => {
        throw new Error('Extension storage is unavailable in content scripts');
    };
    return {
        get: denied,
        set: denied,
        remove: denied,
        clear: denied,
        getBytesInUse: denied,
        getKeys: denied,
        setAccessLevel: denied,
    } as unknown as chrome.storage.StorageArea;
}

function createEmptyStorageEvent(): chrome.events.Event<StorageListener> {
    return {
        addListener() {},
        removeListener() {},
        hasListener() { return false; },
    } as unknown as chrome.events.Event<StorageListener>;
}

export function isTrustedExtensionContext(extensionUrl: string, contextUrl: string): boolean {
    try {
        const extension = new URL(extensionUrl);
        const context = new URL(contextUrl);
        return extension.protocol === 'moz-extension:' &&
            context.protocol === extension.protocol &&
            context.host === extension.host;
    } catch {
        return false;
    }
}

export function createFirefoxStorageFacade(
    nativeStorage: typeof chrome.storage,
    trustedContext: boolean,
): typeof chrome.storage {
    if (!trustedContext) {
        const denied = createDeniedStorageArea();
        return {
            local: denied,
            session: denied,
            sync: denied,
            managed: denied,
            onChanged: createEmptyStorageEvent(),
        } as typeof chrome.storage;
    }

    const listeners = new Set<StorageListener>();
    const nativeListeners = new Map<StorageListener, StorageListener>();
    let channel: BroadcastChannel | null = null;
    let lastSequence = 0;

    const notifyListeners = (changes: StorageChanges): void => {
        for (const listener of listeners) {
            try {
                listener(structuredClone(changes), 'local');
            } catch {
                // A committed storage mutation must not fail because a listener threw.
            }
        }
    };

    const ensureChannel = (): BroadcastChannel | null => {
        if (channel || typeof BroadcastChannel !== 'function') return channel;
        channel = new BroadcastChannel('taskbridge-private-storage-events');
        channel.onmessage = (event: MessageEvent<StorageMutation>) => {
            if (!event.data?.changes || event.data.sequence <= lastSequence) return;
            lastSequence = event.data.sequence;
            notifyListeners(event.data.changes);
        };
        return channel;
    };

    const emitChanges = (mutation: StorageMutation): void => {
        if (mutation.sequence <= lastSequence) return;
        lastSequence = mutation.sequence;
        const relay = structuredClone(mutation);
        try {
            ensureChannel()?.postMessage(relay);
        } catch {
            // Persistence already committed; relay failure cannot roll it back.
        }
        notifyListeners(relay.changes);
    };

    const onChanged = {
        addListener(listener: StorageListener) {
            if (listeners.has(listener)) return;
            listeners.add(listener);
            ensureChannel();
            const nativeListener: StorageListener = (changes, areaName) => {
                if (areaName !== 'local') listener(changes, areaName);
            };
            nativeListeners.set(listener, nativeListener);
            nativeStorage.onChanged.addListener(nativeListener);
        },
        removeListener(listener: StorageListener) {
            listeners.delete(listener);
            const nativeListener = nativeListeners.get(listener);
            if (nativeListener) nativeStorage.onChanged.removeListener(nativeListener);
            nativeListeners.delete(listener);
            if (listeners.size === 0 && channel) {
                channel.close();
                channel = null;
            }
        },
        hasListener(listener: StorageListener) {
            return listeners.has(listener);
        },
    } as chrome.events.Event<StorageListener>;

    const denied = createDeniedStorageArea();
    return {
        local: createPrivateStorageArea(createIndexedDbBackend(), emitChanges),
        session: createTrustedSessionArea(nativeStorage.session),
        sync: denied,
        managed: denied,
        onChanged,
    } as typeof chrome.storage;
}
