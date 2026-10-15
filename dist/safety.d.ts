export declare const DEFAULT_DENYLIST: string[];
export declare function loadDenylist(root: string): Promise<string[]>;
export declare function denied(files: string[], patterns?: string[]): string[];
export declare function secrets(patch: Buffer): string[];
export declare function shareCode(): string;
