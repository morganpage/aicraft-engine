import { generateTerrainArtMaterialAtlas } from './atlas';
import { updateTerrainArtGenerator } from './generator-settings';
import { serializeTerrainArtProject } from './serialize';
import type { TerrainArtProject } from './types';

export interface TerrainArtReferenceEditorOptions {
  readonly project: Readonly<TerrainArtProject>;
  readonly onChange?: (project: TerrainArtProject) => void;
  readonly onSave?: (source: string, project: TerrainArtProject) => void | Promise<void>;
}

export interface TerrainArtReferenceEditorHandle {
  readonly element: HTMLElement;
  getProject(): TerrainArtProject;
  setProject(project: Readonly<TerrainArtProject>): void;
  destroy(): void;
}

/** Mount the dependency-free reference authoring panel. Runtime users need not import this entrypoint. */
export function mountTerrainArtReferenceEditor(host: HTMLElement, options: Readonly<TerrainArtReferenceEditorOptions>): TerrainArtReferenceEditorHandle {
  let project = options.project as TerrainArtProject;
  const root = document.createElement('section'); root.className = 'aicraft-terrain-art-editor';
  const material = document.createElement('select'); material.setAttribute('aria-label', 'Terrain material');
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256; canvas.style.imageRendering = 'pixelated';
  const roundness = document.createElement('input'); roundness.type = 'range'; roundness.min = '0'; roundness.max = '1'; roundness.step = '0.01'; roundness.setAttribute('aria-label', 'Roundness');
  const contour = document.createElement('input'); contour.type = 'range'; contour.min = '0'; contour.max = '64'; contour.step = '1'; contour.setAttribute('aria-label', 'Contour width');
  const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save terrain art';
  root.append(material, roundness, contour, canvas, save); host.append(root);
  const render = (): void => {
    const previous = material.value; material.replaceChildren(...project.materials.map((entry) => { const option = document.createElement('option'); option.value = entry.id; option.textContent = entry.name; return option; }));
    material.value = project.materials.some((entry) => entry.id === previous) ? previous : project.materials[0]?.id ?? '';
    const definition = project.materials.find((entry) => entry.id === material.value);
    if (!definition) return;
    roundness.value = String(definition.generator.roundness); contour.value = String(definition.generator.contourWidth);
    const atlas = generateTerrainArtMaterialAtlas(project, definition.id); const context = canvas.getContext('2d'); if (!context) return;
    const image = context.createImageData(atlas.width, atlas.height); image.data.set(atlas.pixels);
    const buffer = document.createElement('canvas'); buffer.width = atlas.width; buffer.height = atlas.height; buffer.getContext('2d')?.putImageData(image, 0, 0);
    context.imageSmoothingEnabled = false; context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(buffer, 0, 0, canvas.width, canvas.height);
  };
  const change = (): void => { project = updateTerrainArtGenerator(project, material.value, { roundness: Number(roundness.value), contourWidth: Number(contour.value) }); options.onChange?.(project); render(); };
  const select = (): void => render(); const saveNow = (): void => { void options.onSave?.(serializeTerrainArtProject(project), project); };
  material.addEventListener('change', select); roundness.addEventListener('input', change); contour.addEventListener('input', change); save.addEventListener('click', saveNow); render();
  return { element: root, getProject: () => project, setProject: (next) => { project = next as TerrainArtProject; render(); }, destroy: () => { material.removeEventListener('change', select); roundness.removeEventListener('input', change); contour.removeEventListener('input', change); save.removeEventListener('click', saveNow); root.remove(); } };
}
