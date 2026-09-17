import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TOKENS_DIR = 'tokens';
export const BUILD_DIR = 'build';
export const CSS_FILE = '_generated_variables.css';
export const SCSS_FILE = '_generated_variables.scss';
export const TAILWIND_FILE = '_generated_theme.css';

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
  if (path.length === 0) return [];

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
    // `$root` holds the token named after its own group, which is how Figma
    // exports a variable whose name is also a group prefix: `modal.header
    // .padding` sitting alongside `modal.header.padding.mobile`. Every other
    // `$` key is metadata ($type, $value, $description, $extensions).
    const isRoot = key === '$root';
    if (key.startsWith('$') && !isRoot) continue;
    if (value === null || typeof value !== 'object') continue;

    const next = isRoot ? path : [...path, key];
    if (value.$value !== undefined) visit(next, value);
    else walk(value, next, visit);
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
      if (cleaned.length === 0) {
        throw new Error(`Token in ${file} resolves to an empty name (path: ${path.join('.')})`);
      }
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

const cssDeclarations = (tokens) =>
  tokens
    .map(({ name, value, description }) => {
      const comment = description ? ` /* ${description} */` : '';
      return `  --${name}: ${value};${comment}`;
    })
    .join('\n');

export function renderCss(tokens) {
  return `/**\n * ${HEADER}\n */\n\n:root {\n${cssDeclarations(tokens)}\n}\n`;
}

// Figma publishes weights as style names, which are not CSS values.
const FONT_WEIGHTS = {
  thin: 100,
  extralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
  black: 900,
  // Font Awesome ships its icon styles as weights of one family.
  solid: 900,
};

const fontWeight = (value, name) => {
  const style = String(value).toLowerCase().replace(/[\s-]+/g, '');
  if (/^\d+$/.test(style)) return value;

  const weight = FONT_WEIGHTS[style];
  if (weight === undefined) {
    throw new Error(`Unknown font weight "${value}" in ${name}; add it to FONT_WEIGHTS`);
  }
  return weight;
};

// Tailwind only generates a utility class for a theme variable that sits in one
// of its namespaces, and our names mostly already do: `--color-*` drives
// `bg-*`/`text-*`, `--radius-*` drives `rounded-*`. These cover the rest.
// Core values are deliberately left alone - `--space-40` and `--border-5` are
// raw scale entries, not things we want anyone writing `p-40` against.
const TAILWIND_RENAMES = [
  [/^space-(?!\d+$)(.+)$/, 'spacing-$1'],
  [/^text-(.+)-font-size$/, 'text-$1'],
  [/^text-(.+)-font-family$/, 'font-$1'],
  // Tailwind applies a `--text-<name>--<property>` pair whenever the matching
  // `text-<name>` utility is used, so the weight rides along with the size.
  [/^text-(.+)-font-weight$/, 'text-$1--font-weight', fontWeight],
];

export function tailwindToken(token) {
  for (const [pattern, replacement, transform] of TAILWIND_RENAMES) {
    if (!pattern.test(token.name)) continue;
    return {
      ...token,
      name: token.name.replace(pattern, replacement),
      value: transform ? transform(token.value, token.name) : token.value,
    };
  }
  return token;
}

// Tailwind v4 reads its theme from custom properties declared in `@theme`
// rather than a JS config, so the declarations are the same shape as the plain
// CSS, only renamed.
export function renderTailwindTheme(tokens) {
  const renamed = tokens.map(tailwindToken);

  const seen = new Map();
  renamed.forEach(({ name }, index) => {
    const original = tokens[index].name;
    if (seen.has(name)) {
      throw new Error(
        `Tailwind name "${name}" is produced by both ${seen.get(name)} and ${original}`
      );
    }
    seen.set(name, original);
  });

  return `/**\n * ${HEADER}\n */\n\n@theme {\n${cssDeclarations(renamed)}\n}\n`;
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
  writeFileSync(join(buildDir, TAILWIND_FILE), renderTailwindTheme(tokens));

  return { tokens, files: sources.map(({ file }) => file) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { tokens, files } = build();
  console.log(`Read ${tokens.length} tokens from ${files.length} files: ${files.join(', ')}`);
  console.log(
    `Wrote ${[CSS_FILE, SCSS_FILE, TAILWIND_FILE].map((file) => `${BUILD_DIR}/${file}`).join(', ')}`
  );
}
