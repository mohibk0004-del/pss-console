export type Entry = { id: string; title: string; source: string; kind: 'game'|'media'; target: string; args?: string[]; cwd?: string; artwork?: string; iconArtwork?: boolean; backdrop?: string; description?: string; color?: string; favorite?: boolean; lastPlayed?: number; launchType?: 'uri'|'exe'|'shortcut'|'web'|'app'; candidate?: boolean };
export type Settings = { startup: boolean; reducedMotion: boolean; sounds: number; profile: string; jellyfin: string; folders: string[]; browser: string; uiScale: number; onboarded: boolean };
export type Controller = { connected: boolean; name: string; family: 'playstation'|'xbox'; count: number };
export type RunningApp = { id: string; title: string; pid: number; kind: string; window: string };
export type State = { entries: Entry[]; settings: Settings; controller: Controller; running: RunningApp[]; helper: boolean; version: string; mode: string; browser: string; warnings: string[]; overlayId?: string|null; handoff?: {id:string;phase:'launching'|'resuming';waiting?:boolean}|null };
export type ScanResult = { entries: Entry[]; candidates: Entry[]; warnings: string[] };
export type Event = { type: string; action?: string; state?: State; data?: any; message?: string };
export interface Bridge { invoke<T=any>(command: string, data?: unknown): Promise<T>; onEvent(handler: (event: Event)=>void): ()=>void }
declare global { interface Window { pss: Bridge } }
