/**
 * The sections of the console. A section joins with one entry here and one view module; its
 * route is `#/<id>/...`. There is no loader and no registry.
 */
import { diagramsSection } from './views/diagrams.mjs';
import { glossarySection } from './views/glossary.mjs';

export const SECTIONS = [
  { id: 'diagrams', label: 'Diagrams', icon: 'menu', view: diagramsSection },
  { id: 'glossary', label: 'Glossary', icon: 'search', view: glossarySection },
];
