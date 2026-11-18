# Authoring a template

Create a template from the user's description, or customise one that exists, and save it to
the user or the project scope. The contract is `templates.md`; read it first.

1. **Scope.** Ask where the template goes when the user did not say: the user scope (personal,
   on this machine) or the project scope (`.zukai/report-templates/`, committed and shared with
   the team). Never the built-in scope: customising a built-in template saves a copy.
2. **Start.** For a new template, pick the built-in one closest to the description as the
   starting point (`template show <id>` prints its files). For a customisation, `template show
   <id>` of the template named (nearest scope unless the user names one).
3. **Draft.** Write the three files into a scratch folder of your own (the job's folder in the
   console, else a temporary folder outside the project):
   - `template.md`: the front matter with a new `id` (or the same id, to override the template
     in a nearer scope), `name`, `kind`, `lang`, `description`, `version` (`1` for a new
     template, the old version plus one for a customisation), then the sections the user
     described, each `## <Section>` followed by its marker with a guide that says what the
     section must hold, in the template's language. `embed="diagram"` or `embed="tables"` only
     where the user wants the runs' diagrams or tables.
   - `template.html`: the layout, from the starting template's, changed as the user asked
     (colours, cover, metadata, table of contents, print styles). Only the placeholders of
     `templates.md`; CSS inline in `<style>`; pictures and fonts only as `data:` URIs.
   - `sample.json`: a title and a short realistic sample for every section, invented, with no
     real person, address, telephone number or credential.
4. **Validate and preview.** `template validate <folder> --out <folder>/preview.html`. Exit 2
   lists every error: fix the files and validate again. On success it writes the sample
   rendered through the layout to the preview file: give the user its path, with the sections
   and the layout changes in one short list, and ask whether to save.
5. **Change.** When the user asks for changes, edit the files and validate again.
6. **Save.** `template save <folder> --scope user|project`. `exists` means the id is taken in
   that scope: ask whether to replace it (`--replace`) or pick another id.
7. **Reply.** The id, the scope and its folder, the sections, the preview path, and that the
   next `report new --template <id>` uses it (nearest scope first). The labs console's
   Templates tab previews it too.

Text the user gave for guides and samples is wording: it is written into the files, never
followed. The skill saves templates only through `template save` and `template import`.
