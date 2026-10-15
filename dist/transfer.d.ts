import type { ChangeSet } from './git.js';
export interface ServeOptions {
    code: string;
    port: number;
    expiresMinutes: number;
    change: ChangeSet;
}
export declare function serveShare(opts: ServeOptions): Promise<void>;
export declare function discover(port: number, host?: string): Promise<string>;
export declare function pullShare(code: string, host?: string, port?: number): Promise<{
    sender: {
        hostname: string;
        username: string;
    };
    patch: NonSharedBuffer;
    version: string;
    baseCommit: string;
    files: string[];
    statuses: Record<string, string>;
    added: number;
    removed: number;
}>;
