/**
 * The sections of the console. A section joins with one entry here and one view module; its
 * route is `#/<id>/...`. `depth` is how many parts of the route make a new view (the rest is
 * the view's own: a tab, a filter). There is no loader and no registry.
 */
import { overviewSection } from './views/overview.mjs';
import { diagramsSection } from './views/diagrams.mjs';
import { jobsSection } from './views/jobs.mjs';
import { glossarySection } from './views/glossary.mjs';
import { reportsSection } from './views/reports.mjs';

export const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'circle-check', view: overviewSection },
  { id: 'diagrams', label: 'Diagrams', icon: 'menu', view: diagramsSection },
  { id: 'reports', label: 'Reports', icon: 'edit', view: reportsSection },
  { id: 'jobs', label: 'Jobs', icon: 'arrow-right', view: jobsSection },
  { id: 'glossary', label: 'Glossary', icon: 'search', view: glossarySection },
];
