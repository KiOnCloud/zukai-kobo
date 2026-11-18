/** The Diagrams section: the runs list, the forms of a new diagram and a recook, and one run. */
import { runsList } from './runs-list.mjs';
import { newDiagram } from './new-diagram.mjs';
import { runDetail } from './run-detail.mjs';
import { livePicture } from './live-picture.mjs';
import { modelEditor } from './model-editor.mjs';

/** What a run shows beyond its read-only tabs: the live picture and the Model tab. */
const EXTRA_TABS = {
  livePicture: { render: livePicture },
  model: { tab: { value: 'model', label: 'Model' }, render: modelEditor },
};

export function diagramsSection({ store, parts }) {
  const [first, tab] = parts;
  if (!first) return runsList({ store });
  if (first === 'new') return newDiagram({ store });
  if (first === 'recook') return newDiagram({ store, recook: true });
  return runDetail({ store, run: first, tab, extraTabs: EXTRA_TABS });
}
