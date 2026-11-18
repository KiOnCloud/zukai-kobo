/** The Diagrams section: the runs list, the forms of a new diagram and a recook, and one run. */
import { runsList } from './runs-list.mjs';
import { newDiagram } from './new-diagram.mjs';
import { runDetail } from './run-detail.mjs';

export function diagramsSection({ store, parts }) {
  const [first, tab] = parts;
  if (!first) return runsList({ store });
  if (first === 'new') return newDiagram({ store });
  if (first === 'recook') return newDiagram({ store, recook: true });
  return runDetail({ store, run: first, tab });
}
