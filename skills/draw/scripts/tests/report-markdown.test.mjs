import { describe, it, expect } from 'vitest';
import { renderMarkdown, splitSections, stripMarkers, safeHref, escapeHtml } from '../src/report-markdown.mjs';

describe('report Markdown', () => {
  it('shows raw HTML as text, in a paragraph and in a table cell', () => {
    const { html } = renderMarkdown('Hello <b onclick="x()">there</b>\n\n<script>alert(1)</script>\n\n| a | b |\n|---|---|\n| <script>steal()</script> | <img src=x onerror=y> |\n');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<b /);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b onclick=&quot;x()&quot;&gt;');
    expect(html).toMatch(/<table>/);
  });

  it('keeps http, https and in-page links only', () => {
    const { html } = renderMarkdown('[a](https://example.org/x) [b](http://example.org) [c](#h-top) [d](//evil.example/x) [e](javascript:alert(1)) [f](file:///etc/passwd) [g](../up.md)');
    expect(html).toContain('<a href="https://example.org/x">a</a>');
    expect(html).toContain('<a href="http://example.org">b</a>');
    expect(html).toContain('<a href="#h-top">c</a>');
    expect(html).not.toContain('evil.example');
    expect(html).not.toMatch(/href="javascript/i);
    expect(html).not.toContain('file:');
    expect(html).not.toContain('href="../up.md"');
    for (const bad of ['//evil.example', 'javascript:x', 'data:text/html,x', 'https://a b', ' ']) expect(safeHref(bad), bad).toBe(false);
  });

  it('inlines only data: pictures and files of the assets listing', () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const assets = new Map([['shot.png', { bytes: png, mime: 'image/png' }]]);
    const { html } = renderMarkdown('![shot](assets/shot.png) ![dot](data:image/png;base64,iVBORw0KGgo=) ![secret](../../.env) ![up](assets/../report.json) ![svg](data:text/html;base64,PHNjcmlwdD4=) ![missing](assets/none.png)', { assets });
    expect(html).toContain(`src="data:image/png;base64,${png.toString('base64')}"`);
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).not.toContain('.env');
    expect(html).not.toContain('report.json');
    expect(html).not.toContain('data:text/html');
    expect(html.match(/<img /g)).toHaveLength(2);
    expect(html).toContain('[secret]');
  });

  it('gives headings unique ids for the table of contents', () => {
    const ids = new Set();
    const a = renderMarkdown('## Root cause\n\n## Root cause\n\n### 原因 *詳細*', { ids });
    expect(a.headings.map((h) => h.id)).toEqual(['h-root-cause', 'h-root-cause-2', 'h-原因-詳細']);
    const b = renderMarkdown('## Root cause', { ids });
    expect(b.headings[0].id).toBe('h-root-cause-3');
  });

  it('splits sections by markers, keeps markers out of the output and ignores markers in code', () => {
    const md = '# Title\n\nIntro\n\n## Summary\n<!-- zukai:section id="summary" -->\n\nAll good.\n\n```\n<!-- zukai:section id="fake" -->\n```\n\n## Fix\n<!-- zukai:section id="fix" guide="what was changed" embed="diagram" -->\nPatched.\n';
    const { preamble, sections } = splitSections(md);
    expect(preamble).toContain('Intro');
    expect(sections.map((s) => [s.id, s.heading, s.line])).toEqual([['summary', 'Summary', 6], ['fix', 'Fix', 15]]);
    expect(sections[1].attrs).toEqual({ guide: 'what was changed', embed: 'diagram' });
    expect(sections[0].markdown).toContain('```\n<!-- zukai:section id="fake" -->\n```');
    expect(stripMarkers(md)).not.toContain('id="summary"');
    expect(stripMarkers(md)).toContain('id="fake"');
    expect(renderMarkdown(md).html).not.toContain('zukai:section id="summary"');
  });

  it('escapes the five characters of HTML', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
});

describe('character references', () => {
  it('keeps an entity of the Markdown as one, and escapes a bare ampersand', () => {
    const { html } = renderMarkdown('Tom &amp; Jerry &copy; 2026, R&D &#169;');
    expect(html).toContain('Tom &amp; Jerry &copy; 2026, R&amp;D &#169;');
  });
});
