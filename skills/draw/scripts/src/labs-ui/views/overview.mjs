/**
 * The Overview section: what needs the reader now (the agent's question, runs behind their
 * code, reports with findings to fix or a polish draft to review, glossary suggestions, a
 * failed job), the ways to start a diagram, the runs changed last and the jobs closed last.
 * Every number is counted from what the server lists.
 */
import { S } from '../sienna.mjs';
import { h, replace, ago, day } from '../dom.mjs';
import { api } from '../api.mjs';
import { KIND_LABEL, STATE_BADGE, MODES, kindLabel, targetLabel, agentBadge, runsDirOf } from '../words.mjs';
import { badge } from './badge.mjs';
import { glyph } from './glyphs.mjs';
import { attachBlock } from './job-panel.mjs';

const START = [
  ...MODES.map((m) => ({ href: `#/diagrams/new/${m.value}`, glyph: m.value, label: m.value === 'clarify' ? 'From requirements' : m.value === 'scout' ? 'From the code' : 'From an idea', description: m.description })),
  { href: '#/diagrams/recook', glyph: 'drawio', label: 'Recook a diagram', description: 'A draw.io, Mermaid, PlantUML file or a FigJam board made elsewhere' },
];

/** A run as a card: its kinds as glyphs, title, folder and what it holds. */
export function runCard(r) {
  const kinds = [...new Set(r.diagrams.map((d) => d.kind).filter(Boolean))];
  return h('article', { class: 'zl-run-card' },
    h('div', { class: 'zl-run-card-glyphs' }, kinds.slice(0, 3).map((k) => glyph(k, { label: kindLabel(k) }))),
    h('div', { class: 'zl-run-card-body' },
      h('h3', { class: 'heading-sm' }, h('a', { class: 'zl-run-link', href: `#/diagrams/${encodeURIComponent(r.run)}` }, r.title)),
      h('p', { class: 'code caption zl-muted' }, r.run),
      h('p', { class: 'body-sm zl-muted' }, [`${r.diagrams.length} diagram${r.diagrams.length === 1 ? '' : 's'}`, kinds.map(kindLabel).join(', ')].filter(Boolean).join(' · '))),
    h('div', { class: 'zl-run-card-foot' },
      h('span', { class: 'caption zl-muted' }, day(r.date)),
      h('div', { class: 'zl-row' },
        r.stale ? badge({ label: 'Behind the code', tone: 'warning' }) : null,
        r.targets.length ? r.targets.map((t) => badge({ label: targetLabel(t), outline: true })) : badge({ label: 'Model only', outline: true }),
        r.variants?.length ? badge({ label: r.variants.map((v) => v.lang).join(' · '), outline: true }) : null)));
}

export function overviewSection({ store }) {
  const element = h('div', { class: 'zl-page' });
  const attention = h('div', { class: 'zl-attention' });
  const stats = h('dl', { class: 'zl-stats' });
  const recentRuns = h('div', { class: 'zl-run-grid' }, h('p', { class: 'body-sm zl-muted' }, 'Reading the runs'));
  const recentJobs = h('div', {});
  const agentCard = h('div', {});
  let runs = null;
  let jobs = [];
  let reports = null;
  let templates = null;

  const header = h('header', { class: 'zl-page-header' },
    h('div', { class: 'eyebrow' }, 'Project'),
    h('h1', { class: 'display-md zl-project-title' }, store.get().state?.project ?? 'This project'),
    h('p', { class: 'body zl-muted' }, `Diagrams under ${runsDirOf(store)}/, the jobs the agent carries out for them, and the terms they use.`));

  const startGrid = h('div', { class: 'zl-start' }, START.map((s) => h('a', { class: 'zl-start-card', href: s.href },
    h('span', { class: 'zl-start-glyph' }, glyph(s.glyph, { size: 'lg' })),
    h('span', { class: 'heading-sm' }, s.label),
    h('span', { class: 'body-sm zl-muted' }, s.description))));

  function attentionItems(state) {
    const items = [];
    const open = state?.jobs?.open;
    if (open?.state === 'needs-input') items.push({ tone: 'clay', title: 'The agent asks you a question', body: `${KIND_LABEL[open.kind] ?? open.kind}${open.run ? ` · ${open.run}` : ''}`, href: `#/jobs/${encodeURIComponent(open.id)}`, action: 'Answer' });
    if (open?.silent) items.push({ tone: 'warning', title: 'No word from the agent', body: 'The open job has had no word for 15 minutes.', href: `#/jobs/${encodeURIComponent(open.id)}`, action: 'See the job' });
    const failed = jobs.find((j) => j.state === 'failed');
    if (failed) items.push({ tone: 'danger', title: 'A job failed', body: `${KIND_LABEL[failed.kind] ?? failed.kind}${failed.run ? ` · ${failed.run}` : ''} · ${ago(failed.finishedAt)}`, href: `#/jobs/${encodeURIComponent(failed.id)}`, action: 'See why' });
    const stale = (runs ?? []).filter((r) => r.stale);
    if (stale.length) items.push({ tone: 'warning', title: `${stale.length} run${stale.length === 1 ? ' is' : 's are'} behind the code`, body: stale.map((r) => r.title).join(', '), href: stale.length === 1 ? `#/diagrams/${encodeURIComponent(stale[0].run)}` : '#/diagrams', action: 'Review' });
    const toFix = (reports ?? []).filter((r) => r.findings?.blocking);
    if (toFix.length) items.push({ tone: 'warning', title: `${toFix.length} report${toFix.length === 1 ? ' has' : 's have'} findings to fix`, body: toFix.map((r) => r.title).join(', '), href: toFix.length === 1 ? `#/reports/${encodeURIComponent(toFix[0].name)}/glossary` : '#/reports', action: 'Review' });
    const drafted = (reports ?? []).filter((r) => r.drafts);
    if (drafted.length) items.push({ tone: 'clay', title: `${drafted.length} polish draft${drafted.length === 1 ? '' : 's'} to review`, body: drafted.map((r) => r.title).join(', '), href: `#/reports/${encodeURIComponent(drafted[0].name)}`, action: 'Review' });
    if (state?.reportsConfigError) items.push({ tone: 'danger', title: 'The reports folder setting cannot be used', body: `${state.reportsConfigError.message}. ${state.reportsConfigError.hint}`, href: '#/reports', action: 'Open' });
    const suggested = state?.glossary?.counts?.suggested ?? 0;
    if (suggested) items.push({ tone: 'neutral', title: `${suggested} glossary suggestion${suggested === 1 ? '' : 's'} to review`, body: 'A suggestion changes no label until you confirm it.', href: '#/glossary/review', action: 'Review' });
    if (state?.configError) items.push({ tone: 'danger', title: 'The project setting cannot be used', body: `${state.configError.message}. ${state.configError.hint}`, href: '#/diagrams', action: 'Open' });
    if (state?.glossary && !state.glossary.ok) items.push({ tone: 'danger', title: 'The glossary does not match its schema', body: 'Fix .zukai/glossary.json or take it back from git.', href: '#/glossary', action: 'Open' });
    return items;
  }

  function drawAttention() {
    const state = store.get().state;
    const items = attentionItems(state);
    replace(attention, items.length
      ? h('ul', { class: 'zl-attention-list' }, items.map((i) => h('li', { class: ['zl-attention-item', `zl-tone-${i.tone}`] },
        h('div', { class: 'zl-attention-text' }, h('p', { class: 'label' }, i.title), h('p', { class: 'body-sm zl-muted zl-clamp' }, i.body)),
        S().Button({ label: i.action, variant: 'secondary', size: 'sm', href: i.href }))))
      : h('div', { class: 'zl-attention-clear' }, S().icon('circle-check'), h('p', { class: 'body' }, 'Nothing needs you right now.')));
    const counts = state?.glossary?.counts;
    const diagrams = (runs ?? []).reduce((n, r) => n + r.diagrams.length, 0);
    const revisions = (runs ?? []).reduce((n, r) => n + r.revisions, 0);
    replace(stats, [
      ['Runs', runs ? String(runs.length) : '…'],
      ['Diagrams', runs ? String(diagrams) : '…'],
      ['Revisions', runs ? String(revisions) : '…'],
      ['Reports', reports ? String(reports.length) : String(state?.reports ?? '…')],
      ['Templates', templates ? String(templates) : '…'],
      ['Confirmed terms', counts ? String(counts.confirmed) : '0'],
    ].map(([k, v]) => h('div', { class: 'zl-stat' }, h('dt', { class: 'caption zl-muted' }, k), h('dd', { class: 'display-sm' }, v))));
    const b = agentBadge(state);
    replace(agentCard, h('section', { class: 'zl-card-plain' },
      h('div', { class: 'zl-row zl-spread' }, h('h2', { class: 'heading-sm' }, 'Agent'), badge(b)),
      state?.agent?.attached
        ? h('p', { class: 'body-sm zl-muted' }, state.jobs?.open ? `Working on ${KIND_LABEL[state.jobs.open.kind] ?? state.jobs.open.kind}.` : 'Attached and ready for the next job.', state.jobs?.queued ? ` ${state.jobs.queued} job${state.jobs.queued === 1 ? '' : 's'} waiting.` : '')
        : store.get().panelOpen
          ? h('p', { class: 'body-sm zl-muted' }, 'Jobs wait in the queue until an agent attaches; the agent panel shows how.')
          : attachBlock({ onCopyFail: (t) => store.set({ notice: { tone: 'warning', text: `The browser did not allow copying. The command is ${t}.` } }) })));
  }

  function drawRuns() {
    if (!runs) return;
    if (runs.length === 0) { replace(recentRuns, h('div', { class: 'zl-empty' }, h('p', { class: 'body zl-muted' }, `No runs yet. Start one above; the agent writes it under ${runsDirOf(store)}/.`))); return; }
    replace(recentRuns, [...runs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4).map(runCard));
  }

  function drawJobs() {
    if (jobs.length === 0) { replace(recentJobs, h('p', { class: 'body-sm zl-muted' }, 'No jobs yet.')); return; }
    replace(recentJobs, h('ul', { class: 'zl-job-lines' }, jobs.slice(0, 5).map((j) => h('li', { class: 'zl-job-line' },
      h('a', { class: 'label', href: `#/jobs/${encodeURIComponent(j.id)}` }, KIND_LABEL[j.kind] ?? j.kind),
      h('span', { class: 'body-sm zl-muted zl-clamp' }, j.request ?? j.run ?? ''),
      badge(STATE_BADGE[j.state] ?? STATE_BADGE.queued),
      h('span', { class: 'caption zl-muted' }, ago(j.finishedAt ?? j.startedAt ?? j.createdAt))))));
  }

  async function load() {
    const [r, j, rep, tpl] = await Promise.all([api.get('/api/runs'), api.get('/api/jobs'), api.get('/api/reports'), api.get('/api/report-templates')]);
    reports = rep.ok ? rep.data.reports : [];
    templates = tpl.ok ? new Set(tpl.data.templates.filter((t) => t.used).map((t) => t.id)).size : 0;
    if (r.ok) {
      const scouted = r.data.runs.filter((x) => x.scouted);
      const details = await Promise.all(scouted.map((x) => api.get(`/api/runs/${encodeURIComponent(x.run)}`)));
      runs = r.data.runs.map((x) => ({ ...x, stale: details[scouted.indexOf(x)]?.data?.stale?.stale === true }));
    } else replace(recentRuns, S().Alert({ tone: 'danger', body: `The runs could not be read: ${r.error.message}` }));
    jobs = j.ok ? j.data.jobs : [];
    drawRuns();
    drawJobs();
    drawAttention();
  }

  replace(element, header,
    h('section', { class: 'zl-section' }, h('h2', { class: 'heading-md' }, 'Needs you'), attention),
    h('div', { class: 'zl-overview-split' },
      h('section', { class: 'zl-section' }, h('h2', { class: 'heading-md' }, 'Start a diagram'), startGrid),
      h('div', { class: 'zl-stack' }, stats, agentCard)),
    h('section', { class: 'zl-section' }, h('div', { class: 'zl-row zl-spread' }, h('h2', { class: 'heading-md' }, 'Recent runs'), h('a', { class: 'body-sm', href: '#/diagrams' }, 'All runs')), recentRuns),
    h('section', { class: 'zl-section' }, h('div', { class: 'zl-row zl-spread' }, h('h2', { class: 'heading-md' }, 'Recent jobs'), h('a', { class: 'body-sm', href: '#/jobs' }, 'All jobs')), recentJobs));
  drawAttention();
  load();
  return {
    element,
    title: 'Overview',
    reload: load,
    panelChanged: drawAttention,
    stateChanged: (s) => { replace(header.querySelector('.zl-project-title'), s.project); api.get('/api/jobs').then((j) => { if (j.ok) { jobs = j.data.jobs; drawJobs(); } drawAttention(); }); },
  };
}
