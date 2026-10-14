# CLI schemas

Ambient command schemas for binaries Tanit can offer against the current file. One `*-schema.json` per binary. This directory is the only place the app reads them, and the only place the generators write them.

## Current files

| File | Producer |
| --- | --- |
| `tanit-cli-schema.json` | `npm run build:post:cli-schemas:emit` |
| `ffmpeg-schema.json` | `npm run generate:cli-schema -- ffmpeg` |
| `HandBrakeCLI-schema.json` | `npm run generate:cli-schema -- HandBrakeCLI` |
| `soffice-schema.json` | `npm run generate:cli-schema -- soffice` |

`src/commands/cli_schema_catalog.cpp` loads every `*-schema.json` here (not subfolders). The bundle id is the filename with `-schema.json` removed, lowercased: `HandBrakeCLI-schema.json` is `handbrakecli`, `tanit-cli-schema.json` is `tanit-cli`. A file that is not an object, or has no `commands` object, is logged and skipped.

The action pane offers a matching command for the file in front of it. The parameter dialog shows one field per option. `kind: "flag"` is a checkbox. `kind: "enum"` is a choice list. Path, string, number, and float options are text fields. `group` is the heading from `--help`.

## Schema

```json
{
  "bundleVersion": 1,
  "provenance": "cli",
  "trust": "generated",
  "description": "One sentence from the usage line.",
  "schemas": {},
  "commands": {
    "ffmpeg": {
      "description": "What this command does.",
      "options": []
    }
  }
}
```

A binary with no subcommands has one command key, the binary name without `.exe`. A subcommand key is `"<binary> <subcommand>"`.

Every option has `id`, `names`, `description`, `required`, and `kind`. `names` are the tokens printed by `--help`, dashes included. A positional is the usage word with the brackets removed and no dash (`file`, `outfile`).

`kind` is one of:

| Kind | Value | Extra fields |
| --- | --- | --- |
| `path` | file or folder | `accepts`, `generates`, `transport`, `confidence`, `fill` |
| `flag` | no value | none of those |
| `number`, `float`, `string` | one argument | none of those |
| `enum` | one of a printed list | `choices` |

A path sets one side. The other is null, except a folder:

- reads a file: `generates` is null, `fill` is `${CURRENT_SELECTION}`
- writes a file: `accepts` is null, `fill` is `${SRC_DIR}/${SRC_NAME}.<ext>`
- reads a folder: `accepts` is `directory`, `generates` is `none`, `fill` is `${CURRENT_SELECTION}`
- writes a folder: `accepts` is `none`, `generates` is `directory`, `fill` is `${SRC_DIR}`

`accepts` and `generates` for a file are a list of bare extensions, lowercase, no dot. `any` is the string `any` when the help does not name a format. `transport` is `local` unless the value is only a remote path. `confidence` is an integer, 5 when the help names the extension, 4 when a format listing maps to it.

`tanit-cli-schema.json` is the same bundle, filled from `releases/web-docs/schemas/cli.extensions.stage.json`. Its `schemas` object holds the group tokens (`image`, `video`, `audio`, `office`, `text`, `any`, `directory`, `none`). A foreign binary does not use those tokens. It lists extensions on the option.

The writer also stamps `schema` on each path option: `type`, `format: "path"`, `x-pm.extensions`, `x-pm.transport`.

## Tooling

Foreign binary, from the pixlwiz repo root or from `script/`:

```text
npm run generate:cli-schema -- ffmpeg
script\generate-cli-schema.bat ffmpeg --no-web
script\generate-cli-schema.ps1 ffmpeg --stamp-groups
script/generate-cli-schema.sh ffmpeg
```

`script/generate-cli-schema.mjs` runs `tanit-cli llm agent` with `dist/data/prompts/cli-schema.md` as the system prompt. It does not pass `--preset`. `--web` is on by default. The script captures `--help` first (and `-h long` when the help mentions it), scores the reply against that text, rewrites `TOKEN:NAME` fills to `${NAME}`, stamps `group` from the help headings, and writes `<name>-schema.json` in this directory. Captured help and the agent report go to `stemp/cli-schema/`.

`--stamp-groups` rewrites groups on the file already in this directory and does not call the agent.

Tanit itself:

```text
npm run build:post:cli-schemas:emit
```

That runs `scripts/build-post-cli-extensions.mjs --emit-schema` and writes `tanit-cli-schema.json` here.
