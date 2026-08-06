import { compileTerrainArtRuntime, createTerrainArtProject } from 'aicraft-engine';
import { mountTerrainArtReferenceEditor } from 'aicraft-engine/terrain-art/editor';

const handle = mountTerrainArtReferenceEditor(document.querySelector('#terrain-editor')!, {
  project: createTerrainArtProject({ id: 'development-level-art' }),
  onSave(_source, project) {
    const baked = compileTerrainArtRuntime(project);
    console.info(`Baked ${baked.atlases.length} terrain atlas files.`);
  },
});

window.addEventListener('beforeunload', () => handle.destroy(), { once: true });
