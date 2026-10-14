#!/usr/bin/env node
/**
 * Generate an ambient CLI schema for one binary.
 *
 *   node dist/shared/schemas/script/generate-cli-schema.mjs ffmpeg
 *   node dist/shared/schemas/script/generate-cli-schema.mjs ffmpeg --dst dist/shared/schemas/ffmpeg-schema.json
 *
 * Calls `tanit-cli llm agent` with dist/data/prompts/cli-schema.md as
 * --system-prompt. No --preset: the saved chat default is used. A later
 * local-model run passes --preset itself; this script does not.
 *
 * `--web` is on by default and lets the agent request Tavily. `--no-web` skips it.
 * against help text captured from the same binary. Invented flags fail the
 * run. Uncovered path-like help lines are printed as recall gaps.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..', '..', '..');
const PROMPT = join(ROOT, 'dist', 'data', 'prompts', 'cli-schema.md');
const SHARED = join(ROOT, 'dist', 'shared', 'schemas');
const STEMP = join(ROOT, 'stemp', 'cli-schema');

const SIDES = new Set([
  'image', 'video', 'audio', 'office', 'text', 'any', 'directory', 'none',
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { binary: '', dst: '', web: true, stampGroups: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dst') {
      out.dst = argv[++i] || '';
      continue;
    }
    if (arg === '--web') {
      out.web = true;
      continue;
    }
    if (arg === '--no-web') {
      out.web = false;
      continue;
    }
    if (arg === '--stamp-groups') {
      out.stampGroups = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log('usage: node dist/shared/schemas/script/generate-cli-schema.mjs <binary> [--dst path] [--no-web] [--stamp-groups]');
      process.exit(0);
    }
    if (arg.startsWith('-')) fail(`unknown argument: ${arg}`);
    if (out.binary) fail(`one binary only, got ${arg}`);
    out.binary = arg;
  }
  if (!out.binary) fail('usage: node dist/shared/schemas/script/generate-cli-schema.mjs <binary> [--dst path] [--no-web] [--stamp-groups]');
  return out;
}

function cliExe() {
  const env = process.env.PM_IMAGE_CLI || process.env.MEDIA_IMG_CLI_EXE;
  if (env?.trim()) return resolve(env.trim());
  const name = process.platform === 'win32' ? 'tanit-cli.exe' : 'tanit-cli';
  const bundled = join(ROOT, 'dist', 'win-x64', name);
  if (existsSync(bundled)) return bundled;
  return name;
}

function stemName(binary) {
  return binary.replace(/\.exe$/i, '').replace(/^.*[\\/]/, '');
}

function which(binary) {
  const finder = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(finder, [binary], { encoding: 'utf8', timeout: 15_000 });
  const line = String(result.stdout || '').split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return line || '';
}

function captureHelp(exe) {
  const attempts = [];
  for (const flag of ['--help', '-h']) {
    const result = spawnSync(exe, [flag], { encoding: 'utf8', timeout: 20_000 });
    let text = `${result.stdout || ''}\n${result.stderr || ''}`;
    attempts.push({ flag, status: result.status ?? -1, bytes: text.length });
    if (/usage|options|synopsis/i.test(text) && text.length > 80) {
      if (/-h long/.test(text)) {
        const longer = spawnSync(exe, ['-h', 'long'], { encoding: 'utf8', timeout: 20_000 });
        const more = `${longer.stdout || ''}\n${longer.stderr || ''}`;
        attempts.push({ flag: '-h long', status: longer.status ?? -1, bytes: more.length });
        if (more.length > text.length)
          text = `${text}\n${more}`;
      }
      return { text: text.slice(0, 200_000), truncated: text.length > 200_000, attempts };
    }
  }
  const last = attempts[attempts.length - 1];
  return { text: '', truncated: false, attempts, error: last ? `no usage text from ${exe}` : 'no help' };
}

function tavilySearch(exe, name) {
  const result = spawnSync(exe, [
    '--log-level', 'warn',
    'mcp', 'client', 'Tanit', 'tavily-tavily_search',
    '--query', `${name} cli file extensions`,
    '--timeout-ms', '20000',
    '--max_results', '5',
  ], { cwd: ROOT, encoding: 'utf8', timeout: 30_000 });
  const text = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  const path = join(STEMP, `${name}.web.txt`);
  mkdirSync(STEMP, { recursive: true });
  writeFileSync(path, text, 'utf8');
  const unauthorized = /401|invalid API key|Unauthorized/i.test(text);
  return {
    path,
    text,
    unauthorized,
    ok: (result.status ?? 1) === 0 && !unauthorized && text.length > 40,
    status: result.status ?? -1,
  };
}

function runAgent({ exe, prompt, binary, dst, logPath, embed }) {
  const args = [
    '--log-level', 'warn',
    '--cwd', ROOT,
    'llm', 'agent',
    '--single-turn',
    '--no-planner',
    '--no-mcp',
    '--no-skills',
    '--enable-tools', 'run',
    '--max-iter', '8',
    '--system-prompt', `@${prompt}`,
    '--prompt', binary,
    ...(embed ? ['--embed', embed] : []),
    '--dst', dst,
    '--log', logPath,
  ];
  console.log(`\n$ ${exe} ${args.map((a) => JSON.stringify(a)).join(' ')}`);
  const started = performance.now();
  const result = spawnSync(exe, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 300_000,
  });
  const elapsedMs = Math.round(performance.now() - started);
  if (result.stdout) console.log(result.stdout.trimEnd());
  if (result.stderr) console.error(result.stderr.trimEnd());
  return {
    status: result.status ?? -1,
    elapsedMs,
    timedOut: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
    error: result.error ? String(result.error.message || result.error) : '',
    stderr: result.stderr || '',
  };
}

function rewriteFills(doc) {
  const commands = doc?.commands;
  if (!commands || typeof commands !== 'object') return doc;
  for (const body of Object.values(commands)) {
    if (!Array.isArray(body?.options)) continue;
    for (const option of body.options) {
      if (typeof option.Description === 'string' && typeof option.description !== 'string') {
        option.description = option.Description;
        delete option.Description;
      }
      if (typeof option.fill !== 'string' || !option.fill.includes('TOKEN:')) continue;
      option.fill = option.fill.replace(/TOKEN:([A-Z][A-Z0-9_]*)/g, (_, name) => `\${${name}}`);
    }
  }
  return doc;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1].trim() : raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return { value: null, wrapped: fenced != null || start > 0 };
  try {
    return {
      value: JSON.parse(body.slice(start, end + 1)),
      wrapped: fenced != null || start > 0 || end < body.length - 1,
    };
  } catch (err) {
    return { value: null, wrapped: true, error: String(err.message || err) };
  }
}

function extensionList(value) {
  if (!Array.isArray(value) || value.length === 0) return null;
  const exts = [];
  for (const item of value) {
    if (typeof item !== 'string' || SIDES.has(item) || !/^[a-z0-9]{1,8}$/.test(item))
      return null;
    exts.push(item);
  }
  return exts;
}

function isMainFileOption(option) {
  const blob = `${option?.id || ''} ${(option?.names || []).join(' ')} ${option?.description || ''}`;
  return /\b(input|output|infile|outfile|source|dest)\b/i.test(blob);
}

function sideTokens(value, into) {
  if (value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) sideTokens(item, into);
    return;
  }
  if (typeof value === 'string') into.push(value);
}

function optionNames(option) {
  const names = Array.isArray(option?.names) ? option.names : [];
  return names.filter((name) => typeof name === 'string' && name.length > 0);
}

function familyGrounded(help, flag, token) {
  if (!['image', 'video', 'audio', 'office', 'text'].includes(token)) return true;
  const lines = help.split(/\r?\n/).filter((line) => {
    if (flag.startsWith('-')) return helpHasFlag(line, flag);
    return line.includes(flag);
  });
  const blob = lines.join('\n').toLowerCase();
  if (!blob) return false;
  if (token === 'text') return /\b(text|txt|json|markdown|csv|srt|vtt)\b/.test(blob);
  if (token === 'image') return /\b(image|png|jpe?g|webp|gif|bmp|tiff?)\b/.test(blob);
  if (token === 'audio') return /\b(audio|mp3|wav|flac|aac|ogg|m4a)\b/.test(blob);
  if (token === 'video') return /\b(video|mp4|mkv|mov|webm|avi)\b/.test(blob);
  return /\b(docx|xlsx|pptx|office)\b/.test(blob);
}

function helpHasFlag(help, flag) {
  if (flag.startsWith('--')) {
    const body = flag.slice(2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[\\s,(])--${body}(?![\\w-])`, 'm').test(help);
  }
  const body = flag.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s,(])-${body}(?![\\w-])`, 'm').test(help);
}

function pathishFlags(help) {
  const found = new Set();
  const usage = help.split(/\r?\n/).find((line) => /^\s*usage:/i.test(line)) || '';
  for (const match of usage.matchAll(/(-[A-Za-z][\w-]*)\s+([A-Za-z][\w]*)/g)) {
    if (/file|path|dir/i.test(match[2])) found.add(match[1]);
  }
  for (const line of help.split(/\r?\n/)) {
    const match = line.match(/^\s*(-[A-Za-z][\w-]*)\s+(\S+)/);
    if (!match) continue;
    const flag = match[1];
    const arg = match[2];
    const takesValue = arg.startsWith('<') || arg.startsWith('[');
    const argIsPath = /^<?\[?(file|filename|path|dir|directory|folder)/i.test(arg);
    const flagIsPath = /file|path|dir/i.test(flag);
    const descIsPath = takesValue && /\b(file|filename|path|directory|folder)\b/i.test(line);
    if (argIsPath || (flagIsPath && takesValue) || descIsPath) found.add(flag);
  }
  return [...found];
}

function toolRuns(logDoc) {
  const events = Array.isArray(logDoc?.events) ? logDoc.events : [];
  return events
    .filter((event) => event.kind === 'tool_call' || event.kind === 'tool_result')
    .map((event) => ({
      kind: event.kind,
      tool: event.tool || event.tool_name || event.detail?.name || '',
      detail: event.detail || null,
    }));
}

function score({ doc, help, runs, parseError, wrapped, web, stderr }) {
  const weaknesses = [];
  if (!doc) {
    weaknesses.push(parseError ? `reply is not JSON: ${parseError}` : 'reply is not JSON');
    return { weaknesses, invented: [], illegal: [], bothSides: [], uncovered: [], commands: 0, options: 0, ran: false, searched: false };
  }
  if (wrapped) weaknesses.push('reply wrapped the JSON in prose or a fence');
  const commands = doc.commands && typeof doc.commands === 'object' && !Array.isArray(doc.commands)
    ? doc.commands
    : null;
  if (!commands) weaknesses.push('commands is missing');
  const invented = [];
  const illegal = [];
  const bothSides = [];
  const emitted = new Set();
  let options = 0;
  for (const [command, body] of Object.entries(commands || {})) {
    const list = Array.isArray(body?.options) ? body.options : null;
    if (!list) {
      weaknesses.push(`${command}: options is not an array`);
      continue;
    }
    if (typeof body?.description !== 'string' || !body.description.trim())
      weaknesses.push(`${command}: description is empty`);
    for (const option of list) {
      options += 1;
      for (const flag of optionNames(option)) {
        if (flag.startsWith('-')) {
          emitted.add(flag);
          if (help && !helpHasFlag(help, flag)) invented.push(`${command} ${flag}`);
        } else if (help && !help.includes(flag)) {
          invented.push(`${command} ${flag}`);
        }
      }
      const kind = typeof option.kind === 'string' ? option.kind.toLowerCase() : 'path';
      const nonPath = ['flag', 'number', 'float', 'string', 'enum'].includes(kind);
      if (kind !== 'path' && !nonPath)
        weaknesses.push(`${command} ${option.id || '?'}: kind ${option.kind} is not path, flag, number, float, string, or enum`);
      if (kind === 'enum') {
        const choices = Array.isArray(option.choices) ? option.choices.filter((item) => typeof item === 'string' && item) : [];
        if (choices.length < 2)
          weaknesses.push(`${command} ${option.id || '?'}: enum has no choices`);
      }
      if (nonPath)
        continue;
      const accepts = [];
      const generates = [];
      sideTokens(option.accepts, accepts);
      sideTokens(option.generates, generates);
      for (const token of [...accepts, ...generates]) {
        if (!SIDES.has(token) && !/^[a-z0-9]{1,8}$/.test(token))
          illegal.push(`${command} ${option.id || '?'} ${token}`);
        const flag = optionNames(option)[0] || '';
        if (help && flag && !familyGrounded(help, flag, token))
          illegal.push(`${command} ${flag} ${token} not in help`);
      }
      const readsFile = accepts.some((token) => token !== 'none' && token !== 'directory');
      const writesFile = generates.some((token) => token !== 'none' && token !== 'directory');
      const writesFolder = generates.includes('directory');
      const readsFolder = accepts.includes('directory');
      if (isMainFileOption(option) && !writesFolder && !readsFolder) {
        const listed = extensionList(option.accepts) || extensionList(option.generates);
        if (!listed)
          weaknesses.push(`${command} ${option.id || '?'}: main path has no extension list`);
        const fill = typeof option.fill === 'string' ? option.fill : '';
        if (readsFile && fill !== '${CURRENT_SELECTION}')
          weaknesses.push(`${command} ${option.id || '?'}: read fill is not \${CURRENT_SELECTION}`);
        if (writesFile && !Array.isArray(option.generates) && !/\$\{SRC_DIR\}\/\$\{SRC_NAME\}/.test(fill))
          weaknesses.push(`${command} ${option.id || '?'}: write fill has no \${SRC_DIR}/\${SRC_NAME}`);
      }
      if (writesFolder && option.fill !== '${SRC_DIR}')
        weaknesses.push(`${command} ${option.id || '?'}: folder fill is not \${SRC_DIR}`);
      if (readsFolder && option.fill !== '${CURRENT_SELECTION}')
        weaknesses.push(`${command} ${option.id || '?'}: folder fill is not \${CURRENT_SELECTION}`);
      if (readsFile && writesFile) bothSides.push(`${command} ${option.id || optionNames(option)[0] || '?'}`);
      if (accepts.length === 0 && generates.length === 0)
        weaknesses.push(`${command} ${option.id || '?'}: path option sets neither side`);
      const confidence = option.confidence;
      if (confidence != null && (!Number.isInteger(confidence) || confidence < 1 || confidence > 5))
        weaknesses.push(`${command} ${option.id || '?'}: confidence ${confidence}`);
    }
  }
  if (options === 0) weaknesses.push('no path options');
  const ran = runs.some((event) => event.kind === 'tool_call' && event.tool === 'run');
  if (!ran) weaknesses.push('agent did not call run');
  const uncovered = help ? pathishFlags(help).filter((flag) => !emitted.has(flag)) : [];
  if (bothSides.length) weaknesses.push(`both sides set: ${bothSides.join(', ')}`);
  if (invented.length) weaknesses.push(`flags absent from help: ${invented.join(', ')}`);
  if (illegal.length) weaknesses.push(`tokens outside the schema: ${illegal.join(', ')}`);
  return {
    weaknesses,
    invented,
    illegal,
    bothSides,
    uncovered,
    commands: commands ? Object.keys(commands).length : 0,
    options,
    ran,
  };
}

function sectionTitle(raw) {
  return raw.replace(/\s*\(.*$/, '').replace(/\s+options$/i, '').trim();
}

function headingName(line) {
  const trimmed = line.trim();
  if (!trimmed || /^[-{]/.test(trimmed)) return '';
  const ruled = trimmed.match(/^(.+?)\s-{3,}\s*$/);
  if (ruled) return sectionTitle(ruled[1]);
  if (trimmed.length < 90 && /:\s*$/.test(trimmed))
    return sectionTitle(trimmed.replace(/:\s*$/, ''));
  return '';
}

function lineFlags(line) {
  const flags = [];
  if (/\{file\}/.test(line)) flags.push('file');
  for (const match of line.matchAll(/(?:^|[\s,|])(-{1,2}[A-Za-z?][\w:-]*)/g))
    flags.push(match[1]);
  return flags;
}

/** Group each option under the help heading that introduces its flag. */
function stampGroups(help, doc) {
  const sectionOf = new Map();
  let section = '';
  for (const line of String(help || '').split(/\r?\n/)) {
    const heading = headingName(line);
    if (heading) {
      section = heading;
      continue;
    }
    if (!section || !/^\s*(-|\{)/.test(line)) continue;
    for (const flag of lineFlags(line)) {
      if (!sectionOf.has(flag)) sectionOf.set(flag, section);
    }
  }
  for (const body of Object.values(doc?.commands || {})) {
    if (!Array.isArray(body?.options)) continue;
    for (const option of body.options) {
      const names = Array.isArray(option.names) ? option.names : [];
      const group = names.map((name) => sectionOf.get(name)).find(Boolean);
      if (group) option.group = group;
      else if (option.accepts != null || option.generates != null) option.group = 'Files';
    }
  }
  return doc;
}

function sideValue(value) {
  if (!Array.isArray(value) || value.length !== 1 || typeof value[0] !== 'string' || !SIDES.has(value[0]))
    return value;
  return value[0];
}

function withExtensionSchema(option) {
  const next = { ...option, accepts: sideValue(option.accepts), generates: sideValue(option.generates) };
  const exts = extensionList(next.accepts) || extensionList(next.generates);
  if (!exts)
    return next;
  return {
    ...next,
    schema: {
      ...(option.schema && typeof option.schema === 'object' ? option.schema : {}),
      type: 'string',
      format: 'path',
      'x-pm.extensions': exts,
      'x-pm.transport': option.transport || 'local',
    },
  };
}

function writeBundle(dst, doc) {
  const commands = {};
  for (const [name, body] of Object.entries(doc.commands || {})) {
    const options = Array.isArray(body?.options) ? body.options.map(withExtensionSchema) : [];
    commands[name] = { ...body, options };
  }
  const bundle = {
    bundleVersion: 1,
    provenance: 'cli',
    trust: 'generated',
    description: typeof doc.description === 'string' ? doc.description : '',
    schemas: doc.schemas && typeof doc.schemas === 'object' ? doc.schemas : {},
    commands,
  };
  writeFileSync(dst, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!existsSync(PROMPT)) fail(`missing system prompt: ${PROMPT}`);
  const name = stemName(args.binary);
  const dst = resolve(args.dst || join(SHARED, `${name}-schema.json`));
  const exePath = which(args.binary);
  if (!exePath) fail(`${args.binary} is not on PATH. Refusing to ask the model to invent a schema.`);

  const help = captureHelp(exePath);
  mkdirSync(STEMP, { recursive: true });
  mkdirSync(dirname(dst), { recursive: true });
  const helpPath = join(STEMP, `${name}.help.txt`);
  writeFileSync(helpPath, help.text, 'utf8');
  if (!help.text) fail(`${exePath} produced no usage text (${help.attempts.map((a) => a.flag).join(', ')}).`);

  if (args.stampGroups) {
    if (!existsSync(dst)) fail(`no schema to stamp: ${dst}`);
    const doc = JSON.parse(readFileSync(dst, 'utf8'));
    stampGroups(help.text, doc);
    writeFileSync(dst, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    const grouped = Object.values(doc.commands || {}).reduce((count, body) => (
      count + (body.options || []).filter((option) => option.group).length
    ), 0);
    console.log(`groups     ${grouped}`);
    console.log(`dst        ${dst}`);
    return;
  }

  const web = args.web ? tavilySearch(cliExe(), name) : null;
  const logPath = join(STEMP, `${name}-agent.json`);
  const agent = runAgent({
    exe: cliExe(),
    prompt: PROMPT,
    binary: name,
    dst,
    logPath,
    embed: web && web.text ? web.path : '',
  });

  let reply = existsSync(dst) ? readFileSync(dst, 'utf8') : '';
  let logDoc = null;
  if (existsSync(logPath)) {
    try { logDoc = JSON.parse(readFileSync(logPath, 'utf8')); } catch { logDoc = null; }
  }
  if (!reply && logDoc?.result?.final_text) reply = String(logDoc.result.final_text);
  const parsed = extractJson(reply);
  if (parsed.value) rewriteFills(parsed.value);
  if (parsed.value) stampGroups(help.text, parsed.value);
  if (parsed.value?.commands)
    writeBundle(dst, parsed.value);
  const staleMd = dst.endsWith('.json') ? dst.replace(/\.json$/i, '.md') : '';
  if (staleMd && existsSync(staleMd))
    rmSync(staleMd);
  const runs = toolRuns(logDoc);
  const graded = score({
    doc: parsed.value,
    help: help.text,
    runs,
    parseError: parsed.error,
    wrapped: parsed.wrapped,
    web: args.web,
    stderr: agent.stderr,
  });

  const report = {
    binary: name,
    exe: exePath,
    dst,
    helpPath,
    helpBytes: help.text.length,
    helpTruncated: help.truncated,
    agentStatus: agent.status,
    elapsedMs: agent.elapsedMs,
    timedOut: agent.timedOut,
    commands: graded.commands,
    options: graded.options,
    ranHelp: graded.ran,
    web: args.web ? (web?.ok ? 'ok' : web?.unauthorized ? 'unauthorized' : 'failed') : 'off',
    webPath: web?.path || '',
    invented: graded.invented,
    illegal: graded.illegal,
    bothSides: graded.bothSides,
    uncovered: graded.uncovered.slice(0, 40),
    weaknesses: graded.weaknesses,
  };
  const reportPath = join(STEMP, `${name}.report.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`\nbinary     ${name}`);
  console.log(`dst        ${dst}`);
  console.log(`help       ${help.text.length} bytes`);
  console.log(`commands   ${graded.commands}`);
  console.log(`options    ${graded.options}`);
  console.log(`run called ${graded.ran ? 'yes' : 'no'}`);
  console.log(`web        ${args.web ? (web?.ok ? 'ok' : web?.unauthorized ? 'unauthorized' : 'failed') : 'off'}`);
  if (graded.uncovered.length)
    console.log(`uncovered  ${graded.uncovered.slice(0, 20).join(', ')}`);
  for (const item of graded.weaknesses) console.log(`weak       ${item}`);
  console.log(`report     ${reportPath}`);

  const hard = graded.weaknesses.filter((item) => !item.startsWith('reply wrapped'));
  if (agent.status !== 0 || agent.timedOut || hard.length) process.exit(1);
}

main();
