export declare function git(args: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<Buffer<ArrayBufferLike>>;
export declare function repoRoot(): Promise<string>;
export declare function head(cwd: string): Promise<string>;
export interface ChangeSet {
    patch: Buffer;
    files: string[];
    statuses: Record<string, string>;
    added: number;
    removed: number;
    baseCommit: string;
}
export declare function workingChanges(root: string, paths?: string[], includeIgnored?: boolean, denylist?: string[]): Promise<ChangeSet>;
export declare function stashChanges(root: string, ref?: string): Promise<{
    patch: Buffer<ArrayBufferLike>;
    files: string[];
    statuses: {
        [k: string]: string;
    };
    added: number;
    removed: number;
    baseCommit: string;
}>;
export declare function applyPatch(root: string, patch: Buffer, threeWay?: boolean, dryRun?: boolean, reverse?: boolean, reject?: boolean): Promise<void>;
export declare function localChanges(root: string): Promise<boolean>;
export declare function makeUndo(root: string, patch: Buffer): Promise<void>;
export declare function undo(root: string): Promise<void>;
