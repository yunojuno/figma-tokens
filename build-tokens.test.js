import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import {
  BUILD_DIR,
  CSS_FILE,
  SCSS_FILE,
  TAILWIND_FILE,
  TOKENS_DIR,
  build,
  cleanPath,
  collectTokens,
  literalValue,
  readTokenFiles,
  renderCss,
  renderScss,
  renderTailwindTheme,
  resolveTokens,
  tailwindToken,
} from './build-tokens.js';

const colour = (hex, alpha = 1, components = [0, 0, 0]) => ({
  $type: 'color',
  $value: { hex, alpha, components },
});

const number = (value) => ({ $type: 'number', $value: value });
const ref = (target) => ({ $type: 'number', $value: `{${target}}` });
const source = (contents, file = 'test.tokens.json') => [{ file, contents }];

describe('cleanPath', () => {
  it('drops the "Core space" collection wrapper', () => {
    assert.deepEqual(cleanPath(['Core space', 'space-10']), ['space-10']);
  });

  it('renames the "semantic space" collection to "space"', () => {
    assert.deepEqual(cleanPath(['semantic space', 'margin', 'small']), [
      'space',
      'margin',
      'small',
    ]);
  });

  it('renames the Figma variable literally named "null" to space-0', () => {
    assert.deepEqual(cleanPath(['Core space', 'null']), ['space-0']);
  });

  it('publishes Figma\'s font-style as font-weight', () => {
    assert.deepEqual(cleanPath(['text', 'heading', 'XL', 'font-style']), [
      'text',
      'heading',
      'xl',
      'font-weight',
    ]);
  });

  it('converts underscores to hyphens', () => {
    assert.deepEqual(cleanPath(['color', 'compliance', 'employee_w2']), [
      'color',
      'compliance',
      'employee-w2',
    ]);
  });

  it('converts spaces to hyphens and lowercases', () => {
    assert.deepEqual(cleanPath(['text', 'body', 'default prominent']), [
      'text',
      'body',
      'default-prominent',
    ]);
  });

  it('leaves an already-clean path untouched', () => {
    assert.deepEqual(cleanPath(['color', 'blueberry50']), ['color', 'blueberry50']);
  });
});

describe('literalValue', () => {
  it('lowercases hex colours', () => {
    assert.equal(literalValue(colour('#4D51C9')), '#4d51c9');
  });

  it('emits rgba() for partially transparent colours', () => {
    assert.equal(literalValue(colour('#FF8000', 0.5, [1, 0.5, 0])), 'rgba(255, 128, 0, 0.5)');
  });

  it('uses hex when a colour is fully opaque', () => {
    assert.equal(literalValue(colour('#FFFFFF', 1)), '#ffffff');
  });

  it('appends px to numbers', () => {
    assert.equal(literalValue(number(32)), '32px');
  });

  it('leaves zero unitless, since 0px is redundant', () => {
    assert.equal(literalValue(number(0)), '0');
  });

  it('passes strings through untouched', () => {
    assert.equal(literalValue({ $type: 'string', $value: 'Semi Bold' }), 'Semi Bold');
  });
});

describe('collectTokens', () => {
  it('flattens nested groups into dot keys and hyphen names', () => {
    const { tokens } = collectTokens(
      source({ color: { action: { primary: colour('#000000') } } })
    );
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].key, 'color.action.primary');
    assert.equal(tokens[0].name, 'color-action-primary');
  });

  it('ignores $-prefixed metadata such as $extensions', () => {
    const { tokens } = collectTokens(
      source({
        $extensions: { 'com.figma.modeName': 'Mode 1' },
        color: { white: colour('#FFFFFF') },
      })
    );
    assert.deepEqual(
      tokens.map((t) => t.key),
      ['color.white']
    );
  });

  it('treats $root as a token named after its parent group', () => {
    const { tokens } = collectTokens(source({ modal: { padding: { $root: number(40) } } }));
    assert.deepEqual(
      tokens.map((t) => t.name),
      ['modal-padding']
    );
  });

  it('emits both $root and its siblings', () => {
    const { tokens } = collectTokens(
      source({ modal: { padding: { mobile: number(20), $root: number(40) } } })
    );
    assert.deepEqual(
      tokens.map((t) => t.name),
      ['modal-padding-mobile', 'modal-padding']
    );
  });

  it('resolves a group nested under $root against the parent path', () => {
    const { tokens } = collectTokens(source({ a: { b: { $root: { c: number(1) } } } }));
    assert.deepEqual(
      tokens.map((t) => t.name),
      ['a-b-c']
    );
  });

  it('throws rather than emitting an unnamed variable for a top-level $root', () => {
    assert.throws(
      () => collectTokens(source({ $root: number(40) })),
      /resolves to an empty name/
    );
  });

  it('maps the original Figma path so aliases can be rewritten', () => {
    const { pathMap } = collectTokens(source({ 'Core space': { 'space-10': number(10) } }));
    assert.equal(pathMap.get('Core space.space-10'), 'space-10');
  });

  it('throws when two files produce the same token name', () => {
    assert.throws(
      () =>
        collectTokens([
          { file: 'a.tokens.json', contents: { color: { white: colour('#FFFFFF') } } },
          { file: 'b.tokens.json', contents: { color: { white: colour('#000000') } } },
        ]),
      /Duplicate token name "color.white" from a.tokens.json and b.tokens.json/
    );
  });
});

describe('resolveTokens', () => {
  it('resolves an alias to its target literal', () => {
    const tokens = resolveTokens(
      source({ 'border-5': number(5), radius: { sm: ref('border-5') } })
    );
    const radius = tokens.find((t) => t.name === 'radius-sm');
    assert.equal(radius.value, '5px');
  });

  it('rewrites aliases that point at a renamed collection', () => {
    const tokens = resolveTokens(
      source({
        'Core space': { 'space-35': number(35) },
        'semantic space': { margin: { small: ref('Core space.space-35') } },
      })
    );
    const margin = tokens.find((t) => t.name === 'space-margin-small');
    assert.equal(margin.value, '35px');
  });

  it('follows multi-hop alias chains', () => {
    const tokens = resolveTokens(
      source({ a: number(8), b: ref('a'), c: ref('b') })
    );
    assert.equal(tokens.find((t) => t.name === 'c').value, '8px');
  });

  it('throws on an alias that points nowhere', () => {
    assert.throws(
      () => resolveTokens(source({ broken: ref('does.not.exist') })),
      /Unresolved reference \{does\.not\.exist\} in broken/
    );
  });

  it('throws on a circular alias instead of recursing forever', () => {
    assert.throws(
      () => resolveTokens(source({ a: ref('b'), b: ref('a') })),
      /Circular reference/
    );
  });

  it('carries the description through for rendering', () => {
    const tokens = resolveTokens(
      source({ color: { white: { ...colour('#FFFFFF'), $description: 'UI background' } } })
    );
    assert.equal(tokens[0].description, 'UI background');
  });
});

describe('renderCss', () => {
  const rendered = renderCss([
    { name: 'color-white', value: '#ffffff', description: 'UI background' },
    { name: 'space-10', value: '10px' },
  ]);

  it('warns against editing the generated file', () => {
    assert.match(rendered, /^\/\*\*\n \* Do not edit directly, this file was auto-generated\.\n \*\//);
  });

  it('declares custom properties inside :root', () => {
    assert.match(rendered, /:root \{\n {2}--color-white: #ffffff;/);
    assert.match(rendered, /\n\}\n$/);
  });

  it('renders descriptions as CSS block comments', () => {
    assert.match(rendered, /--color-white: #ffffff; \/\* UI background \*\//);
  });

  it('omits the comment when a token has no description', () => {
    assert.match(rendered, /--space-10: 10px;\n/);
  });
});

describe('tailwindToken', () => {
  const name = (tokenName) => tailwindToken({ name: tokenName, value: '1px' }).name;
  const weight = (style) =>
    tailwindToken({ name: 'text-heading-xl-font-weight', value: style }).value;

  it('leaves core space values alone, since p-40 is not a class we want', () => {
    assert.equal(name('space-0'), 'space-0');
    assert.equal(name('space-40'), 'space-40');
  });

  it('moves semantic space tokens into the spacing namespace', () => {
    assert.equal(name('space-margin-small'), 'spacing-margin-small');
    assert.equal(name('space-component-padding-2xl'), 'spacing-component-padding-2xl');
  });

  it('leaves core border widths alone, as Tailwind has no namespace for them', () => {
    assert.equal(name('border-5'), 'border-5');
    assert.equal(name('border-full'), 'border-full');
  });

  it('leaves colours and radii untouched, as they are already in a namespace', () => {
    assert.equal(name('color-blueberry-700'), 'color-blueberry-700');
    assert.equal(name('color-action-primary-default'), 'color-action-primary-default');
    assert.equal(name('radius-sm'), 'radius-sm');
  });

  it('drops the font-size suffix so the text namespace generates text-* classes', () => {
    assert.equal(name('text-heading-xl-font-size'), 'text-heading-xl');
    assert.equal(name('text-body-small-prominent-font-size'), 'text-body-small-prominent');
  });

  it('moves font families into the font namespace', () => {
    assert.equal(name('text-heading-xl-font-family'), 'font-heading-xl');
  });

  it('pairs font weights with their font size', () => {
    const mapped = tailwindToken({ name: 'text-heading-xl-font-weight', value: 'Bold' });
    assert.equal(mapped.name, 'text-heading-xl--font-weight');
  });

  it('turns Figma style names into numeric font weights', () => {
    assert.equal(weight('Regular'), 400);
    assert.equal(weight('Semi Bold'), 600);
    assert.equal(weight('Bold'), 700);
  });

  it('treats Font Awesome\'s Solid style as a weight', () => {
    assert.equal(weight('Solid'), 900);
  });

  it('passes an already numeric weight straight through', () => {
    assert.equal(weight('500'), '500');
  });

  it('throws on a style name it cannot turn into a weight', () => {
    assert.throws(() => weight('Ultra Condensed'), /Unknown font weight "Ultra Condensed"/);
  });

  it('carries the description through the rename', () => {
    const mapped = tailwindToken({
      name: 'space-margin-small',
      value: '15px',
      description: 'Small margin',
    });
    assert.equal(mapped.description, 'Small margin');
  });
});

describe('renderTailwindTheme', () => {
  const tokens = [
    { name: 'color-white', value: '#ffffff', description: 'UI background' },
    { name: 'space-10', value: '10px' },
  ];
  const rendered = renderTailwindTheme(tokens);

  it('warns against editing the generated file', () => {
    assert.match(rendered, /^\/\*\*\n \* Do not edit directly, this file was auto-generated\.\n \*\//);
  });

  it('declares custom properties inside @theme rather than :root', () => {
    assert.match(rendered, /@theme \{\n {2}--color-white: #ffffff;/);
    assert.match(rendered, /\n\}\n$/);
    assert.ok(!rendered.includes(':root'));
  });

  it('renders descriptions as CSS block comments', () => {
    assert.match(rendered, /--color-white: #ffffff; \/\* UI background \*\//);
  });

  it('renames tokens into their Tailwind namespace', () => {
    const theme = renderTailwindTheme([{ name: 'space-margin-small', value: '15px' }]);
    assert.match(theme, /--spacing-margin-small: 15px;/);
    assert.ok(!theme.includes('--space-margin-small'));
  });

  it('throws when two tokens collapse onto the same Tailwind name', () => {
    assert.throws(
      () =>
        renderTailwindTheme([
          { name: 'text-heading-xl', value: '10px' },
          { name: 'text-heading-xl-font-size', value: '32px' },
        ]),
      /Tailwind name "text-heading-xl" is produced by both text-heading-xl and text-heading-xl-font-size/
    );
  });
});

describe('renderScss', () => {
  const rendered = renderScss([
    { name: 'color-white', value: '#ffffff', description: 'UI background' },
    { name: 'space-10', value: '10px' },
  ]);

  it('warns against editing the generated file', () => {
    assert.match(rendered, /^\n\/\/ Do not edit directly, this file was auto-generated\.\n/);
  });

  it('declares bare variables with no :root wrapper', () => {
    assert.match(rendered, /\$space-10: 10px;/);
    assert.ok(!rendered.includes(':root'));
  });

  it('renders descriptions as SCSS line comments, not block comments', () => {
    assert.match(rendered, /\$color-white: #ffffff; \/\/ UI background/);
    assert.ok(!rendered.includes('/*'));
  });
});

describe('the real token set', () => {
  const sources = readTokenFiles(TOKENS_DIR);
  const tokens = resolveTokens(sources);

  it('reads every .tokens.json file in the tokens directory', () => {
    assert.ok(sources.length >= 5, `expected at least 5 token files, got ${sources.length}`);
    assert.ok(sources.every(({ file }) => file.endsWith('.tokens.json')));
  });

  it('produces names that are safe to use as CSS identifiers', () => {
    const invalid = tokens.filter(({ name }) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name));
    assert.deepEqual(invalid.map((t) => t.name), []);
  });

  it('leaves no unresolved aliases in any value', () => {
    const unresolved = tokens.filter(({ value }) => /^\{.+\}$/.test(String(value)));
    assert.deepEqual(unresolved.map((t) => t.name), []);
  });

  it('gives every token a non-empty value', () => {
    const empty = tokens.filter(({ value }) => value === '' || value == null);
    assert.deepEqual(empty.map((t) => t.name), []);
  });

  it('emits no duplicate names', () => {
    const counts = new Map();
    for (const { name } of tokens) counts.set(name, (counts.get(name) ?? 0) + 1);
    assert.deepEqual([...counts].filter(([, n]) => n > 1), []);
  });

  it('publishes the $root modal padding alongside its mobile sibling', () => {
    const byName = new Map(tokens.map((t) => [t.name, t.value]));
    assert.equal(byName.get('space-modal-header-padding'), '40px');
    assert.equal(byName.get('space-modal-header-padding-mobile'), '20px');
  });

  it('keeps the semantic colours aliased to the core palette in step', () => {
    const byName = new Map(tokens.map((t) => [t.name, t.value]));
    // action.primary.default aliases core blueberry-700 in Figma.
    assert.equal(byName.get('color-action-primary-default'), byName.get('color-blueberry-700'));
    assert.equal(byName.get('color-text-accent'), byName.get('color-blueberry-700'));
  });

  it('maps every semantic token onto a unique Tailwind name', () => {
    const counts = new Map();
    for (const { name } of tokens.map(tailwindToken)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    assert.deepEqual([...counts].filter(([, n]) => n > 1), []);
  });

  it('exposes the semantic scales as Tailwind utilities', () => {
    const names = new Set(tokens.map((token) => tailwindToken(token).name));
    // p-component-padding-md, text-heading-xl, font-heading-xl, rounded-md.
    assert.ok(names.has('spacing-component-padding-md'));
    assert.ok(names.has('text-heading-xl'));
    assert.ok(names.has('font-heading-xl'));
    assert.ok(names.has('radius-md'));
  });

  it('gives every font weight a numeric value Tailwind can use', () => {
    const weights = tokens
      .map(tailwindToken)
      .filter(({ name }) => name.endsWith('--font-weight'));
    assert.ok(weights.length > 0, 'expected to find font weight tokens');
    const bad = weights.filter(({ value }) => !/^\d+$/.test(String(value)));
    assert.deepEqual(bad.map((t) => `${t.name}: ${t.value}`), []);
  });

  it('gives every dimension a unit unless it is zero', () => {
    const dimensions = tokens.filter(({ name }) =>
      /^(space|border|radius)(-|$)/.test(name) || name.endsWith('-font-size')
    );
    assert.ok(dimensions.length > 0, 'expected to find dimension tokens');
    const bad = dimensions.filter(({ value }) => value !== '0' && !/^-?[\d.]+px$/.test(value));
    assert.deepEqual(bad.map((t) => `${t.name}: ${t.value}`), []);
  });
});

describe('build', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'figma-tokens-'));
  after(() => rmSync(outDir, { recursive: true, force: true }));

  it('writes a CSS, an SCSS and a Tailwind theme file', () => {
    const { tokens } = build({ buildDir: outDir });
    assert.equal(readFileSync(join(outDir, CSS_FILE), 'utf8'), renderCss(tokens));
    assert.equal(readFileSync(join(outDir, SCSS_FILE), 'utf8'), renderScss(tokens));
    assert.equal(
      readFileSync(join(outDir, TAILWIND_FILE), 'utf8'),
      renderTailwindTheme(tokens)
    );
  });

  it('is idempotent', () => {
    const first = readFileSync(join(outDir, CSS_FILE), 'utf8');
    build({ buildDir: outDir });
    assert.equal(readFileSync(join(outDir, CSS_FILE), 'utf8'), first);
  });

  // This repo commits its build output and consumers install it straight from
  // git, so stale artefacts ship silently. Historically that is exactly what
  // went wrong, hence guarding it here.
  it('matches the committed output in build/', () => {
    const tokens = resolveTokens(readTokenFiles(TOKENS_DIR));
    const message = 'committed build output is stale - run `npm run build` and commit the result';
    assert.equal(readFileSync(join(BUILD_DIR, CSS_FILE), 'utf8'), renderCss(tokens), message);
    assert.equal(readFileSync(join(BUILD_DIR, SCSS_FILE), 'utf8'), renderScss(tokens), message);
    assert.equal(
      readFileSync(join(BUILD_DIR, TAILWIND_FILE), 'utf8'),
      renderTailwindTheme(tokens),
      message
    );
  });
});
