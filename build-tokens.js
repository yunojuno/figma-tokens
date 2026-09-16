import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TOKENS_DIR = 'tokens';
export const BUILD_DIR = 'build';
export const CSS_FILE = '_generated_variables.css';
export const SCSS_FILE = '_generated_variables.scss';

// Figma names its variable collections for designers, not for CSS. These
// rewrite the top-level group of a path: `null` drops the segment entirely.
const COLLECTION_RENAMES = {
  'Core space': null,
  'semantic space': 'space',
};

// Figma stores the font's style name ("Semi Bold") under `font-style`, which is
// what the previous Tokens Studio pipeline emitted as `font-weight`. Keep the
// published name so consumers don't break.
const PROPERTY_RENAMES = {
  'font-style': 'font-weight',
};

// A Figma variable literally named "null" holds the zero-space value.
const SEGMENT_RENAMES = {
  null: 'space-0',
};

const HEADER = 'Do not edit directly, this file was auto-generated.';

const slug = (segment) => segment.trim().toLowerCase().replace(/[\s_]+/g, '-');

export function cleanPath(path) {
  const [head, ...rest] = path;
  const renamed = head in COLLECTION_RENAMES ? COLLECTION_RENAMES[head] : head;
  const segments = renamed === null ? rest : [renamed, ...rest];
  return segments.map((segment) => {
    const s = slug(segment);
    return SEGMENT_RENAMES[s] ?? PROPERTY_RENAMES[s] ?? s;
  });
}

const isReference = (value) => typeof value === 'string' && /^\{.+\}$/.test(value);

function walk(node, path, visit) {
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    if (value === null || typeof value !== 'object') continue;
    if (value.$value !== undefined) visit([...path, key], value);
    else walk(value, [...path, key], visit);
  }
}

export function literalValue(token) {
  const { $type: type, $value: value } = token;

  if (type === 'color') {
    if (value.alpha !== undefined && value.alpha < 1) {
      const [r, g, b] = value.components.map((c) => Math.round(c * 255));
      return `rgba(${r}, ${g}, ${b}, ${value.alpha})`;
    }
    return value.hex.toLowerCase();
  }

  // Every number Figma exports is a dimension: spacing, radii and font sizes.
  if (type === 'number') {
    return value === 0 ? '0' : `${value}px`;
  }

  return value;
}

/** Flattens `[{ file, contents }]` into tokens keyed by their cleaned path. */
export function collectTokens(sources) {
  const tokens = [];
  const pathMap = new Map(); // original dot path -> cleaned dot path
  const seen = new Map();

  for (const { file, contents } of sources) {
    walk(contents, [], (path, token) => {
      const cleaned = cleanPath(path);
      const key = cleaned.join('.');
      if (seen.has(key)) {
        throw new Error(`Duplicate token name "${key}" from ${seen.get(key)} and ${file}`);
      }
      seen.set(key, file);
      pathMap.set(path.join('.'), key);
      tokens.push({ key, name: cleaned.join('-'), token });
    });
  }

  return { tokens, pathMap };
}

/** Resolves every alias down to a literal, ready for rendering. */
export function resolveTokens(sources) {
  const { tokens, pathMap } = collectTokens(sources);
  const byKey = new Map(tokens.map((entry) => [entry.key, entry]));

  const resolve = (entry, chain = []) => {
    const raw = entry.token.$value;
    if (!isReference(raw)) return literalValue(entry.token);

    const target = pathMap.get(raw.slice(1, -1));
    const next = target && byKey.get(target);
    if (!next) throw new Error(`Unresolved reference ${raw} in ${entry.key}`);
    if (chain.includes(target)) {
      throw new Error(`Circular reference: ${[...chain, target].join(' -> ')}`);
    }
    return resolve(next, [...chain, target]);
  };

  return tokens.map((entry) => ({
    name: entry.name,
    value: resolve(entry),
    description: entry.token.$description,
  }));
}

export function renderCss(tokens) {
  const lines = tokens.map(({ name, value, description }) => {
    const comment = description ? ` /* ${description} */` : '';
    return `  --${name}: ${value};${comment}`;
  });
  return `/**\n * ${HEADER}\n */\n\n:root {\n${lines.join('\n')}\n}\n`;
}

export function renderScss(tokens) {
  const lines = tokens.map(({ name, value, description }) => {
    const comment = description ? ` // ${description}` : '';
    return `$${name}: ${value};${comment}`;
  });
  return `\n// ${HEADER}\n\n${lines.join('\n')}\n`;
}

export function readTokenFiles(tokensDir = TOKENS_DIR) {
  return readdirSync(tokensDir)
    .filter((file) => file.endsWith('.tokens.json'))
    .sort()
    .map((file) => ({
      file,
      contents: JSON.parse(readFileSync(join(tokensDir, file), 'utf8')),
    }));
}

export function build({ tokensDir = TOKENS_DIR, buildDir = BUILD_DIR } = {}) {
  const sources = readTokenFiles(tokensDir);
  const tokens = resolveTokens(sources);

  mkdirSync(buildDir, { recursive: true });
  writeFileSync(join(buildDir, CSS_FILE), renderCss(tokens));
  writeFileSync(join(buildDir, SCSS_FILE), renderScss(tokens));

  return { tokens, files: sources.map(({ file }) => file) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { tokens, files } = build();
  console.log(`Read ${tokens.length} tokens from ${files.length} files: ${files.join(', ')}`);
  console.log(`Wrote ${BUILD_DIR}/${CSS_FILE} and ${BUILD_DIR}/${SCSS_FILE}`);
}
