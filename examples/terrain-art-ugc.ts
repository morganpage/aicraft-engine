import {
  compileTerrainArtRuntime, createMemoryTerrainArtStorage, createTerrainArtProject,
  loadTerrainArtProject, saveTerrainArtProject,
} from 'aicraft-engine';
import { mountTerrainArtReferenceEditor } from 'aicraft-engine/terrain-art/editor';

const fallback = createTerrainArtProject({ id: 'player-terrain' });
const storage = createMemoryTerrainArtStorage();
const restored = await loadTerrainArtProject(storage, fallback.id);
const editor = mountTerrainArtReferenceEditor(document.querySelector('#terrain-editor')!, {
  project: restored.project ?? fallback,
  async onSave(_source, project) {
    await saveTerrainArtProject(storage, project);
    const runtimeOnlyArtifact = compileTerrainArtRuntime(project);
    dispatchEvent(new CustomEvent('terrain-art-baked', { detail: runtimeOnlyArtifact }));
  },
});

export const disposeTerrainEditor = (): void => editor.destroy();
