import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TOKENS_DIR = 'tokens';
const BUILD_DIR = 'build';

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

function cleanPath(path) {
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

function collectTokens() {
  const files = readdirSync(TOKENS_DIR)
    .filter((file) => file.endsWith('.tokens.json'))
    .sort();

  const tokens = [];
  const pathMap = new Map(); // original dot path -> cleaned dot path
  const seen = new Map();

  for (const file of files) {
    const contents = JSON.parse(readFileSync(join(TOKENS_DIR, file), 'utf8'));
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

  return { tokens, pathMap, files };
}

function literalValue(token) {
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

function resolveTokens() {
  const { tokens, pathMap, files } = collectTokens();
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

  const resolved = tokens.map((entry) => ({
    name: entry.name,
    value: resolve(entry),
    description: entry.token.$description,
  }));

  return { resolved, files };
}

function renderCss(tokens) {
  const lines = tokens.map(({ name, value, description }) => {
    const comment = description ? ` /* ${description} */` : '';
    return `  --${name}: ${value};${comment}`;
  });
  return `/**\n * ${HEADER}\n */\n\n:root {\n${lines.join('\n')}\n}\n`;
}

function renderScss(tokens) {
  const lines = tokens.map(({ name, value, description }) => {
    const comment = description ? ` // ${description}` : '';
    return `$${name}: ${value};${comment}`;
  });
  return `\n// ${HEADER}\n\n${lines.join('\n')}\n`;
}

const { resolved, files } = resolveTokens();

mkdirSync(BUILD_DIR, { recursive: true });
writeFileSync(join(BUILD_DIR, '_generated_variables.css'), renderCss(resolved));
writeFileSync(join(BUILD_DIR, '_generated_variables.scss'), renderScss(resolved));

console.log(`Read ${resolved.length} tokens from ${files.length} files: ${files.join(', ')}`);
console.log(`Wrote ${BUILD_DIR}/_generated_variables.css and ${BUILD_DIR}/_generated_variables.scss`);
