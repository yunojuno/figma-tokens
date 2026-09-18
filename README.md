# Figma tokens

The single source of truth for YunoJuno's design tokens - colour, spacing, border and
typography - and the generated stylesheets that platform code consumes.

Designers maintain the tokens as variables in Figma. Those variables are exported to the
[design token format](https://tr.designtokens.org/format/) JSON files in `tokens/`,
and a build step turns them into three stylesheets in `build/`:

| File                        | Used by                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `_generated_variables.css`  | Plain CSS custom properties on `:root`                            |
| `_generated_variables.scss` | SCSS variables, for stylesheets that can't read custom properties |
| `_generated_theme.css`      | Tailwind v4 `@theme` block, so tokens drive utility classes       |

Consumers install this repo as a dev dependency:

```
npm install github:yunojuno/figma-tokens#<release-version> --save-dev
```

## How the build works

`build-tokens.js` reads every `*.tokens.json` file in `tokens/`, flattens the nested groups
into flat token names, resolves aliases (`{Core space.space-10}`) down to literal values, and
writes the three files above. It also reconciles the differences between how Figma names
things and what CSS needs - dropping designer-facing collection prefixes, converting font
style names like "Semi Bold" into numeric weights, and renaming tokens into the namespaces
Tailwind recognises. Those mappings are the constants at the top of `build-tokens.js`; add
to them when Figma introduces a name the build doesn't know about.

The build fails loudly rather than emitting something subtly wrong: duplicate token names,
unresolved or circular aliases, and unknown font weights all raise an error.

Run it locally with:

```
npm run build
npm test
```

The generated files are committed, so `npm test` asserts against the current contents of
`build/` - run the build before the tests.

## Updating tokens

1. When designers update tokens in Figma, they should be able to provide you updated 
   Figma Variable exports that you can overwrite the file(s) in `tokens/` with. Only `tokens/` 
   should be edited by hand; never `build/`. NOTE: You may need to rename the exports to match
   the convention in `tokens/`.
2. Open a pull request. The [Build workflow](https://github.com/yunojuno/figma-tokens/actions)
   regenerates `build/` and commits the result back to your branch, then runs the tests.
3. Review the generated diff along with the token change - it's the clearest signal of what
   consumers will actually see.
4. Merge to `main`.

## Releasing a new version

Nothing reaches the platform until a release is tagged.

1. Check the build has run and `build/` is up to date on `main`. See the
   [actions tab](https://github.com/yunojuno/figma-tokens/actions).
2. Bump `"version"` in [package.json](https://github.com/yunojuno/figma-tokens/blob/main/package.json#L3).
3. Create a [new release](https://github.com/yunojuno/figma-tokens/releases/new) with a tag
   matching that version, and make sure "latest release" is checked.
4. Notify the dev team in #dev.

A new release won't appear in platform environments until the dependency is updated there.
That normally happens as part of the weekly dependency updates; to pull it in sooner, run:

```
npm install @yunojuno/figma-tokens@github:yunojuno/figma-tokens#<release-version>
```
