# it-diagrams

Agent Skill that turns clarified requirements, an existing codebase or a raw idea into IT
diagrams and emits them to three targets. One source folder, `skills/it-diagrams/`, ships as a
Claude Code plugin and as a plain skill copy for OpenAI Codex.

Install: `/plugin install it-diagrams --marketplace KiOnCloud/it-diagrams` (see
[docs/install.md](docs/install.md) for the two-step form, Codex and credentials).
New here? Read [docs/quickstart.md](docs/quickstart.md).

## Entry point

```text
/it-diagrams:it-diagrams <clarify|scout|brainstorm> [--to mermaid|drawio|figjam]
```

| Mode | What happens |
|---|---|
| `clarify` | Interview the user until every required slot of the chosen diagram kind is filled, at most three rounds |
| `scout` | Read the codebase and derive the diagram from entry points, call chains, enums, entities or the DI graph |
| `brainstorm` | From a raw idea propose two or three candidate diagram sets, let the user pick, then clarify |

Before drawing, the skill asks one question (one `AskUserQuestion` call in Claude Code, one
message elsewhere): the diagram kind, the scope (`overview` or `detailed`), the view
(`technical`, `business` or `both`), and the mode when it was left out, all in the user's
language with the keyword in parentheses. Flags such as
`--kind`, `--scope` and `--audience` skip the matching part.

In Codex the same modes are reached by asking in prose after `$it-diagrams`.

## Targets

| Target | Output | Notes |
|---|---|---|
| `drawio` | `.drawio` file, uncompressed mxGraph XML | Default; every shape and edge individually editable, laid out automatically |
| `mermaid` | Mermaid text | Paste into Markdown |
| `figjam` | New or existing FigJam board | Needs the Figma MCP server in the session; falls back to Mermaid text |

Diagram kinds: sequence, flowchart, state, ER, class, architecture, and activity with
swimlanes, fork and join (draw.io is the activity target; Mermaid renders it with the beta
`swimlane-beta` syntax and FigJam does not support it).

## How it works

The model never hand-writes Mermaid or XML. Every flow ends the same way: write a JSON
intermediate representation (IR), validate it, fix the full error list, then emit.

```text
clarify | scout | brainstorm  ->  ir.json  ->  validate  ->  feature matrix  ->  emit
```

The feature matrix is data. For each kind, target and feature it says `supported`,
`degraded` (emitted with an explicit warning naming what was lost) or `unsupported` (fails
validation for that target). Nothing is approximated silently.

## Requirements

- Node 22.13 or newer. The emitters are a committed single-file bundle; consumers never run
  `npm install`.
- Optional: draw.io desktop for previews, the Figma MCP server for the FigJam target.

## Development

```bash
cd skills/it-diagrams/scripts && npm ci && npm test
```

Plan and research: [plans/261104-1501-it-diagrams-plugin/plan.md](plans/261104-1501-it-diagrams-plugin/plan.md).
Third-party code in the bundle: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE). The committed CLI bundle also carries elkjs (EPL-2.0) and ajv (MIT); see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
