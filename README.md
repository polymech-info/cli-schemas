# CLI schemas

Ambient command schemas for binaries Tanit can offer against the current file. One `*-schema.json` per binary. The contract is [SPEC.md](SPEC.md). Generators write into this directory. The app also reads `%APPDATA%\PolyMech\tanit\schemas`, and that copy replaces the same bundle id.

## Current files

| File | Producer |
| --- | --- |
| `tanit-cli-schema.json` | `npm run build:post:cli-schemas:emit` |
| `ffmpeg-schema.json` | `npm run generate:cli-schema -- ffmpeg` |
| `HandBrakeCLI-schema.json` | `npm run generate:cli-schema -- HandBrakeCLI` |
| `soffice-schema.json` | `npm run generate:cli-schema -- soffice` |

`src/commands/cli_schema_catalog.cpp` loads every `*-schema.json` (not subfolders). The bundle id is the filename with `-schema.json` removed, lowercased: `HandBrakeCLI-schema.json` is `handbrakecli`, `tanit-cli-schema.json` is `tanit-cli`. A file that is not an object, or has no `commands` object, is logged and skipped.

The action pane offers a matching command for the file in front of it. Field types, sides, fills, and group tokens are defined in [SPEC.md](SPEC.md).

`tanit-cli-schema.json` is that bundle, filled from `releases/web-docs/schemas/cli.extensions.stage.json`. Its `schemas` object holds the group tokens. A foreign binary lists extensions on the option.

## Tooling

| Project | Format | Coverage | Purpose |
|---|---|---|---|
| [Fig Autocomplete](https://github.com/withfig/autocomplete) | TypeScript | Large community catalog | Commands, arguments, options, completions |
| [Carapace](https://github.com/rsteube/carapace-bin) | YAML / Go | Broad CLI coverage | Cross-shell completion definitions |
| [OpenCLI](https://github.com/opencli-dev/opencli) | JSON Schema-oriented | Emerging | Machine-readable CLI contracts |
| [CLI Spec](https://clispec.dev/) | Structured specification | Emerging | CLI interface descriptions |
| [clap](https://github.com/clap-rs/clap) | Rust | Framework | Typed command definitions |
| [Cobra](https://github.com/spf13/cobra) | Go | Framework | Commands, flags, completions |
| [Click](https://github.com/pallets/click) | Python | Framework | Typed CLI parameters |

```text
tanit-cli schema gen ffmpeg
tanit-cli schema gen ffmpeg --no-web
tanit-cli schema gen ffmpeg --stamp-groups
npm run generate:cli-schema -- ffmpeg
script\generate-cli-schema.bat ffmpeg
script/generate-cli-schema.sh ffmpeg
```

`tanit-cli schema gen` and `script/generate-cli-schema.mjs` run `tanit-cli llm agent` with `dist/data/prompts/cli-schema.md` as the system prompt. It does not pass `--preset`. `--web` is on by default. The script captures `--help` first (and `-h long` when the help mentions it), scores the reply against that text, rewrites `TOKEN:NAME` fills to `${NAME}`, stamps `group` from the help headings, and writes `<name>-schema.json` in this directory. Captured help and the agent report go to `stemp/cli-schema/`.

`--stamp-groups` rewrites groups on the file already in this directory and does not call the agent.

## Agent and web grounding

`tanit-cli schema gen` captures `--help`, then `-h`. A capture counts as help only when it is longer than 80 bytes and contains a usage, options, or synopsis line. Anything else is discarded. The attempts are still written to `<name>.help.txt`.

The system prompt is the first existing file of `%APPDATA%\PolyMech\tanit\prompts\cli-schema.md`, then `dist/data/prompts/cli-schema.md`. The profile copy wins. The agent runs in-process. It is not given `run`. With web on, the only path tool is `info_lookup`, and MCP stays enabled so it can call Tavily. `--no-web` turns MCP off and does not start the agent when the capture has no usage line.

| Captured help | What `names` may come from | What an extension may come from |
| --- | --- | --- |
| A usage line is present | That text only. A flag from the web page is rejected as invented. | The help, a format listing in the help, or a Tavily result when the extension is not in either stream. |
| Both streams are empty and web is on | The Tavily page, the exact tokens it prints. | That same page. |
| Both streams are empty and web is off | The agent is not started. | — |

Empty help tells the agent to call `info_lookup` with kind `mcp` and query `tavily`, then `request_tools` for the `mcp_*` name, then that tool. The search is the binary name plus command-line options. It must not start `tanit-cli mcp client`. If lookup, the grant, or the search returns nothing, the reply is an empty `commands` object.

The scorer compares flags and positionals to the captured help. When that help is empty, the invented-flag check and the "token not in help" check are skipped. A web-grounded file can promote with `invented: []` even though those names were not checked against the page. `cli_schema` check still rejects a bad `kind`, an enum with fewer than two choices, both sides set, and a path that sets neither side.

Consent for the Tavily call is the native Win32 dialog unless the selected preset sets another consent mode.

## Todos

Schema validation belongs in `cli_schema` action `check`, the same call the agent already uses to correct a candidate. Do not validate against [OpenCLI](https://github.com/opencli-dev/opencli/blob/main/schema/opencli.schema.json). That schema is the pattern (draft 2020-12, `additionalProperties: false`, errors the model can fix). Its document is not ours: it requires `opencli`, and `commands` is an array of command objects. Ours is the object in [SPEC.md](SPEC.md).

- [ ] Write `cli.schema.json` next to SPEC.md for bundle version 1. Required `commands` object. Option `kind` enum. Path sides, fills, and `confidence` 1–5. `schemas` entries that carry `x-pm.extGroup` also carry `enum`, except the hardcoded `any` and `directory` tokens.
- [ ] Run that schema inside `CliSchemaTool::invoke` on action `check`, before `score_doc`. Return a `schemaErrors` array of `{instancePath, message}`. `ok` stays false while it is non-empty, so the agent fixes the document and calls `check` again.
- [ ] Keep evidence checks in the scorer. A JSON Schema cannot see the captured help or the Tavily page, so invented flags, uncovered flags, and "token not in help" stay in `weaknesses`. When help is empty, those checks stay skipped.
- [ ] Point editors at the schema with an optional `$schema` field on the bundle. The catalog ignores it.
- [ ] Do not accept an OpenCLI document in `check`. A root `opencli` key or a `commands` array is a schema error, not a second format.

Tanit itself:

```text
npm run build:post:cli-schemas:emit
```

That runs `scripts/build-post-cli-extensions.mjs --emit-schema` and writes `tanit-cli-schema.json` here.
