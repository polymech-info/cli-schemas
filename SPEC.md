# Ambient CLI schema

Version 1. One JSON file per binary, named `<name>-schema.json`. The bundle id is that filename with `-schema.json` removed, compared case-insensitively: `HandBrakeCLI-schema.json` is `handbrakecli`.

This file is the contract. `src/commands/cli_schema_catalog.cpp` loads it. `src/commands/cli_schema_gen.cpp` scores a generated file against it. The parameter dialog reads the projection in `help_option_from_ambient`.

## Where files are read

`cli_schema_directories()` scans, in order:

1. `exe/../shared/schemas`, `exe/shared/schemas`, `exe/schemas`
2. On Windows, `%APPDATA%\PolyMech\tanit\schemas`

Only regular files in that directory match. Subfolders are not scanned. A later directory replaces the same bundle id. The catalog loads once per process.

A file is skipped, with a log line, when it is not a JSON object or has no `commands` object. Side files must not use the `*-schema.json` suffix. Use `<name>.help.txt`, `<name>.reply.txt`, `<name>.trace.txt`, `<name>.candidate.json`, `<name>.report.json`.

## Document

| Field | Required to load | Meaning |
| --- | --- | --- |
| `commands` | yes | Object. One entry per command. Not an array. |
| `schemas` | no | Object of value schemas. Absent or empty is valid. |
| `bundleVersion` | no | `1`. Recorded. Not read by the catalog. |
| `provenance` | no | `cli` for a generated bundle. Not read by the catalog. |
| `trust` | no | `generated`. Not read by the catalog. |
| `description` | no | One sentence from the usage line. Not read by the catalog. |
| `branches` | no | Present on `tanit-cli-schema.json` only. Not read by the catalog. |

`binary` may appear on a generator reply. It is not part of the stored bundle.

## Commands

Each key is the command line without the executable path.

- A binary with no subcommands uses one key: the binary name, no `.exe`. Example: `ffmpeg`.
- A subcommand key is the binary name, a space, then the subcommand words. Example: `audio filter`, `pdf md`.

The first word is the root. For `tanit-cli` that root selects the action-pane heading (Image, Search, LLM & Agents, and the rest of the table in `doc_group_for_root`). An unknown root is `Other`. A foreign binary uses the same rule and lands in `Other` unless the root is one of those names.

| Field | Required | Meaning |
| --- | --- | --- |
| `description` | yes for a generated file | Non-empty string. Shown as the offer tooltip when present. The generator rejects an empty description. |
| `options` | yes | Array. The generator rejects a missing array. An empty array loads and matches nothing. |

## Options

Every option is an object. The dialog drops an option whose `names` array is missing or empty.

| Field | Required | Meaning |
| --- | --- | --- |
| `names` | yes for the dialog | Array of strings. Tokens as printed by `--help`, dashes included. A positional is the usage word with brackets removed and no leading dash (`file`, `outfile`). `names[0]` is the primary token. |
| `id` | no | Stable name. The dialog uses it as the field name. When absent, `names[0]` is used. |
| `description` | no | Help sentence. |
| `required` | no | Boolean. Missing or non-boolean is false. True only when the help marks the option required, or the synopsis shows it outside brackets. |
| `kind` | no | See below. Missing means `path`. |
| `group` | no | Help-section heading. Missing or empty becomes `Options` in the dialog. |
| `choices` | for `enum` | Array of non-empty strings. |
| `accepts` | for a read | Read side. See Sides. |
| `generates` | for a write | Write side. See Sides. |
| `fill` | for a path | Suggested argument. See Fills. |
| `transport` | no | `local` or `http`. Not read by the catalog. |
| `confidence` | no | Integer 1–5. Not read by the catalog. The generator rejects a value outside that range. |
| `schema` | no | Stamped JSON Schema for a path. Not read by the catalog. |

`kind` is one of `path`, `flag`, `number`, `float`, `string`, `enum`. Any other value fails the generator. The dialog maps them as follows:

| `kind` | Control | Notes |
| --- | --- | --- |
| `path` (default) | text | `typeName` `PATH`. One argument. |
| `flag` | checkbox | No argument. `fill` is cleared. |
| `number` | text | `typeName` `NUMBER`. |
| `float` | text | `typeName` `FLOAT`. |
| `string` | text | `typeName` `TEXT`. |
| `enum` | select | Only when `choices` has at least two strings. Fewer choices stay a text field. |

`flag`, `number`, `float`, `string`, and `enum` do not carry `accepts`, `generates`, or `fill`.

A name is positional when `names[0]` does not start with `-`. The dialog shows a positional. It does not seed a positional fill into argv.

## Sides

`accepts` is what the option reads. `generates` is what it writes. One option sets one side.

A side value is one of:

- `null` — that side is unset
- the string `none` — that side returns no file
- the string `directory` — a folder
- the string `any` — any file, not a folder
- an array of bare extensions, lowercase, no dot: `["mp4","mkv"]`
- a single string token, including a group token

`null` and `none` are the same to the matcher: that side does not match.

An option is a reader only when `accepts` is set and not `none`, and `generates` is missing, `null`, or `none`. An option with extensions on both sides is not a reader. The generator rejects that with `both sides set`. A load/save config file is a read: `accepts` is the extension, `generates` is null.

Folder forms:

| Role | `accepts` | `generates` |
| --- | --- | --- |
| read a folder | `directory` | `none` |
| write a folder | `none` | `directory` |

File forms:

| Role | `accepts` | `generates` |
| --- | --- | --- |
| read a file | extension list, `any`, or a group token | `null` |
| write a file | `null` | extension list, `any`, or a group token |

A converter uses two options. The same extension list may sit on the input option's `accepts` and, separately, on the output option's `generates`.

### Match

The action pane calls `cli_offers_for` with the file extension, or with the directory flag set. An empty schema id offers every loaded bundle. A non-empty id offers that bundle only. At most 8 offers are kept per bundle.

For each command, every reader option is tested. The command matches when one reader matches. Score 2 when a match is a specific extension or an expanded group. Score 1 when the only match is `any`. Specific scores sort first, then the tanit heading order, then the command key.

A token matches as follows:

| Token | Matches |
| --- | --- |
| `none`, empty | never |
| `directory` | a folder, not a file |
| `any` | a file, not a folder |
| a group name | a file whose extension is in that group's `enum`, and only when this bundle's `schemas` defines it |
| anything else | a file whose extension equals the token |

A group is an object under `schemas` with string `x-pm.extGroup` and an `enum` array of extensions. The catalog lowercases those extensions. `directory` and `any` match by the table above. They do not need an `enum`. A family word with no group in this bundle matches only a file whose extension is that word.

`tanit-cli-schema.json` defines groups `image`, `video`, `audio`, `office`, `any`, and `directory`. A foreign bundle leaves `schemas` empty and lists extensions on the option. It does not use `image`, `video`, `audio`, `office`, or `text` in place of that list.

`text` is a legal generator token. This catalog does not treat it as "any text file". That behavior belongs to ribbon `extension_maps` in `launcher_commands.cpp`, which is a different document.

When a command matches, each required reader whose `names[0]` starts with `-` appends that flag and then `${CURRENT_SELECTION}` to the offer arguments. The words after the first word of the command key are the subcommand arguments.

## Fills

`fill` is the suggested argument, not a flag and not an extension. The dialog copies it to `default`.

| Role | `fill` |
| --- | --- |
| read a file or a folder | `${CURRENT_SELECTION}` |
| write a folder | `${SRC_DIR}` |
| write one file | `${SRC_DIR}/${SRC_NAME}.<ext>` |

`<ext>` is one extension from `generates`, no dot in the extension, with the dot before it in the fill. When several extensions may be written, use the one the help treats as the usual output, otherwise the first entry of `generates`.

`CURRENT_SELECTION` is the selected files. In an argument list the bare token becomes one argument per file. `SRC_DIR` is the source folder. `SRC_NAME` is the name without the extension. `SRC_EXT` is the extension without the dot. No other names are defined.

The generator rejects a file-read whose fill is not `${CURRENT_SELECTION}`, a folder-read with any other fill, a folder-write whose fill is not `${SRC_DIR}`, and a file-write whose `generates` is not an array and whose fill does not contain `${SRC_DIR}/${SRC_NAME}`.

The dialog seeds a fill into an empty argv slot when the option is required, or when the fill is exactly `${CURRENT_SELECTION}` and exactly one option in that command has that fill. Optional writes stay placeholders. Positionals are not seeded.

## `schemas`

Keys are `$id` strings such as `pm://types/ext.image/1`. The catalog reads two fields:

| Field | Meaning |
| --- | --- |
| `x-pm.extGroup` | Token used on `accepts` or `generates`. |
| `enum` | Extensions that token expands to. |

`x-pm.glob`, `title`, `description`, `const`, and `type` are recorded for the tanit bundle. The catalog does not read them.

Transport values `local` and `http` are documented by `pm://types/transport/1`. `local` is a filesystem path. `http` is a VFS or CMS remote path. A path that may also be a URL stays `local`. The catalog does not read `transport`.

## Stamped `schema`

The writer may add this object on a path option. The catalog ignores it.

```json
{
  "type": "string",
  "format": "path",
  "x-pm.extensions": ["mp4", "mkv"],
  "x-pm.transport": "local"
}
```

`x-pm.extensions` repeats the file side. `x-pm.transport` repeats `transport`.

## Generator rules

These apply to `tanit-cli schema gen`. The catalog still loads a file that breaks them.

- `names` are exact tokens from the captured help. When both streams lack a usage line, they are the exact tokens from the web page used for that run. Do not rename `-i` to `--input`.
- Skip `-h`, `--help`, and `--version`.
- An extension is lowercase, 1–8 characters, letters and digits only. A longer token is illegal.
- `confidence` is 5 when the help names the extension, 4 when a format listing maps to it, 3 when the side is `any` because no format is named, 2 when the sentence mixes a file and a folder, 1 when the option should not be emitted.
- A flag or positional that does not appear in the captured help is invented. The check is skipped when the help text is empty.
- The reply is one JSON object. Prose or a markdown fence is a failure.

## Example

Shape only. Flags and extensions come from the binary's help.

```json
{
  "bundleVersion": 1,
  "provenance": "cli",
  "trust": "generated",
  "description": "Example converter: example [options] -i infile outfile",
  "schemas": {},
  "commands": {
    "example": {
      "description": "Reads a media file and writes a converted file.",
      "options": [
        {
          "id": "input",
          "names": ["-i"],
          "description": "Input file",
          "required": true,
          "kind": "path",
          "accepts": ["mp4", "mkv", "wav"],
          "generates": null,
          "transport": "local",
          "confidence": 5,
          "fill": "${CURRENT_SELECTION}"
        },
        {
          "id": "output",
          "names": ["outfile"],
          "description": "Output file",
          "required": true,
          "kind": "path",
          "accepts": null,
          "generates": ["mp4"],
          "transport": "local",
          "confidence": 5,
          "fill": "${SRC_DIR}/${SRC_NAME}.mp4"
        },
        {
          "id": "markers",
          "names": ["-m", "--markers"],
          "description": "Add chapter markers",
          "required": false,
          "kind": "flag"
        }
      ]
    }
  }
}
```
