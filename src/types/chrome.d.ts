/**
 * Chrome Extension API Type Definitions
 * For ClickUp Gmail Chrome Extension
 */

declare namespace chrome {
    namespace storage {
        interface StorageArea {
            get(keys?: string | string[] | object | null): Promise<{ [key: string]: any }>;
            set(items: { [key: string]: any }): Promise<void>;
            remove(keys: string | string[]): Promise<void>;
            clear(): Promise<void>;
        }

        const local: StorageArea;
        const sync: StorageArea;
    }

    namespace runtime {
        interface MessageSender {
            tab?: chrome.tabs.Tab;
            frameId?: number;
            id?: string;
            url?: string;
        }

        interface Port {
            name: string;
            disconnect(): void;
            onDisconnect: chrome.events.Event<(port: Port) => void>;
            onMessage: chrome.events.Event<(message: any, port: Port) => void>;
            postMessage(message: any): void;
            sender?: MessageSender;
        }

        function sendMessage<T = any>(message: any): Promise<T>;
        function sendMessage<T = any>(extensionId: string, message: any): Promise<T>;
        function getURL(path: string): string;

        const onMessage: chrome.events.Event<(
            message: any,
            sender: MessageSender,
            sendResponse: (response?: any) => void
        ) => boolean | void>;

        const onInstalled: chrome.events.Event<(details: { reason: string }) => void>;

        const lastError: { message?: string } | undefined;
    }

    namespace identity {
        function getRedirectURL(): string;
        function launchWebAuthFlow(
            details: { url: string; interactive: boolean },
            callback?: (responseUrl?: string) => void
        ): Promise<string>;
    }

    namespace tabs {
        interface Tab {
            id?: number;
            url?: string;
            title?: string;
            active: boolean;
            windowId: number;
        }

        function query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
        function sendMessage<T = any>(tabId: number, message: any): Promise<T>;
    }

    namespace windows {
        interface CreateData {
            url?: string;
            type?: 'normal' | 'popup' | 'panel';
            width?: number;
            height?: number;
            left?: number;
            top?: number;
            focused?: boolean;
        }

        function create(createData: CreateData): Promise<chrome.windows.Window>;

        interface Window {
            id?: number;
            focused: boolean;
            top?: number;
            left?: number;
            width?: number;
            height?: number;
        }
    }

    namespace events {
        interface Event<T extends Function> {
            addListener(callback: T): void;
            removeListener(callback: T): void;
            hasListener(callback: T): boolean;
        }
    }
}

// Declare chrome as global
declare const chrome: typeof chrome;
