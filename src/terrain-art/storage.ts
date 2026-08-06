import { deserializeTerrainArtProject, serializeTerrainArtProject } from './serialize';
import type { TerrainArtProject } from './types';

export interface TerrainArtStorageAdapter {
  load(projectId: string): string | null | Promise<string | null>;
  save(projectId: string, source: string): void | Promise<void>;
  remove(projectId: string): void | Promise<void>;
}

export interface TerrainArtStorageResult {
  readonly ok: boolean;
  readonly project?: TerrainArtProject;
  readonly error?: 'unavailable' | 'invalid-source' | 'write-failed';
}

export function createMemoryTerrainArtStorage(initial: Readonly<Record<string, string>> = {}): TerrainArtStorageAdapter {
  const values = new Map(Object.entries(initial));
  return { load: (id) => values.get(id) ?? null, save: (id, source) => { values.set(id, source); }, remove: (id) => { values.delete(id); } };
}

export async function saveTerrainArtProject(adapter: TerrainArtStorageAdapter, project: Readonly<TerrainArtProject>): Promise<TerrainArtStorageResult> {
  try {
    const source = serializeTerrainArtProject(project);
    if (!source) return { ok: false, error: 'invalid-source' };
    await adapter.save(project.id, source);
    return { ok: true, project: project as TerrainArtProject };
  } catch { return { ok: false, error: 'write-failed' }; }
}

export async function loadTerrainArtProject(adapter: TerrainArtStorageAdapter, projectId: string): Promise<TerrainArtStorageResult> {
  try {
    const source = await adapter.load(projectId);
    if (source === null) return { ok: false, error: 'unavailable' };
    const project = deserializeTerrainArtProject(source);
    return project === null ? { ok: false, error: 'invalid-source' } : { ok: true, project };
  } catch { return { ok: false, error: 'unavailable' }; }
}

export function hashTerrainArtProject(project: Readonly<TerrainArtProject>): string {
  const source = serializeTerrainArtProject(project);
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
