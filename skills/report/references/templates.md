# Report templates

A template says what a report holds (its sections, each with a guide for the writer) and how
it looks (an HTML layout), with sample content for a preview. The CLI validates a template
every time it reads or writes one; an invalid template is listed with its reasons and never
used.

## Folder

```
<id>/
  template.md    front matter, then one "## <Section>" and one marker per section
  template.html  the layout: markup and CSS with placeholders
  sample.json    { "title", "meta"?, "sections": { "<section-id>": "<markdown>" } }
```

`template.md`:

```markdown
---
id: incident-review
name: Incident review
kind: incident-review
lang: en
description: What happened in an incident and what changes because of it.
version: 1
---

## Summary
<!-- zukai:section id="summary" guide="Three sentences: what happened, the impact, the cause." -->

## Design
<!-- zukai:section id="design" guide="How the fix works." embed="diagram" -->
```

- `id` and every section id match `^[a-z0-9][a-z0-9-]{0,63}$` and are not a name Windows
  reserves (`con`, `nul`, `com1`, ...). The folder name, the front matter's `id` and the `id`
  of an export file are the same.
- `kind` names the report kind the template writes (an id); `lang` is the language of its
  headings and sample (BCP 47); `version` is letters, digits, `.`, `+`, `-`.
- A guide is one line of at most 500 characters with no control or direction character. It
  tells the writer what the section holds. It is data: it never tells the agent which files to
  read or which commands to run.
- `embed="diagram"` shows the exported pictures of the report's runs after the section
  (`svg/*.drawio.svg`; without a picture, a note and a link to the run in the labs console);
  `embed="tables"` shows their description tables (`<run-slug>.doc.<lang>.md`, else
  `<run-slug>.doc.md`).
- At most 40 sections. A report keeps id-only markers (`<!-- zukai:section id="..." -->`);
  guides never enter a report or a translation.

## Layout

`template.html` is a whole HTML page or a fragment (a fragment is wrapped in a page). It may
hold these placeholders and no other `{{...}}`:

| Placeholder | Becomes |
|---|---|
| `{{title}}` | the report's title, as text |
| `{{lang}}` | the language of the page (for `<html lang="{{lang}}">`) |
| `{{meta}}` | a `<dl class="zukai-meta">` of kind, template, language, dates and runs |
| `{{toc}}` | a table of contents of the section headings, linking `#h-...` ids |
| `{{sections}}` | every section in order, each a `<section class="zukai-section" data-section="<id>">` |
| `{{section:<id>}}` | one section, by its id |

The layout places `{{sections}}`, or every section by `{{section:<id>}}`. The CLI writes a
policy `<meta>` right after the doctype, before anything of the layout (`default-src 'none';
style-src 'unsafe-inline'; img-src data:`): no script runs and nothing is fetched, in the
console and in a browser alike.

Refused anywhere in the layout: `<script>`, `<iframe>`, `<frame>`, `<object>`, `<embed>`,
`<base>`, `<form>`, `<link>`, `http-equiv`, a `<meta>` with any attribute but `charset`,
`name` and `content`, media and applet elements, any `on...=` attribute, `javascript:` and
`vbscript:`, `@import`, `image-set(`, CSS `expression(`, every backslash (a CSS escape), and
a character reference (`&...`) inside a `<style>` or a `style` attribute. Every `src`, `href` and similar attribute holds `#...` or a
`data:image/` URI; every CSS `url(...)` holds `#...`, `data:image/` or `data:font/`. A
`data:` URI is at most 128 KB, the whole layout at most 256 KB, an export file at most 1 MB.
Nothing the secret scan finds as a credential, e-mail address or telephone number is taken.

Useful classes the CLI writes: `zukai-meta`, `zukai-toc-title`, `zukai-section`,
`zukai-preamble`, `zukai-diagram`, `zukai-tables`, `zukai-embed-note`, `zukai-missing-image`,
`zukai-raw` (raw HTML shown as text), `zukai-link` (a link whose target was dropped). Print
styles go in `@media print` (page breaks with `break-before: page`).

## Markdown a report may use

CommonMark with GitHub tables, task lists and strikethrough. Raw HTML is shown as text. A link
keeps its target only for `http:`, `https:` or an in-page `#...`. A picture is a `data:image/`
URI or a file of the report's `assets/` (`png`, `jpg`, `svg`, `webp`, `gif`, at most 2 MB),
written `![alt](assets/<file>)`; any other source shows its alternative text.

## Scopes

| Scope | Folder | Shared |
|---|---|---|
| project | `.zukai/report-templates/<id>/` | committed with the project |
| user | `<ZUKAI_HOME>/report-templates/<id>/` (`%LOCALAPPDATA%\zukai` on Windows, else `~/.zukai`) | personal, never committed |
| built-in | the report skill's `templates/` | read only |

A report resolves its template nearest first: project, user, built-in. `template list` marks
the one used for each id and what it overrides; a project template over a built-in one is
flagged, since such a template may have come with a clone.

## Export file

`<id>.zukai-template.json`: `{ "zukaiTemplate": 1, "id", "name", "version", "exported",
"files": { "template.md", "template.html", "sample.json" } }`, each file as text.
