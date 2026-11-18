# Contributing

Thanks for wanting to help. Gally is a small project with one maintainer, and it gets better when people who use it send back what they find.

You don't need to write code to contribute. A clear bug report from a real device is often worth more than a patch.

## Ways to help

- **Report a bug.** Use the [bug report form](https://github.com/realsamrat/gally/issues/new?template=bug_report.yml). Say which component, which browser and device, and whether you used a mouse, a trackpad or touch. A short screen recording helps most with anything about motion.
- **Test on a real device.** Gestures are tuned by feel, and so far they have mostly been tested in Chrome on a Mac and in Safari on the iPhone simulator. If a pinch, a flick or a zoom feels wrong on your phone, tablet or browser, that's a useful report.
- **Measure something.** If a surface drops frames for you, a performance trace or the numbers from `npm run bench:fps` turn "it feels slow" into something that can be fixed.
- **Fix something.** Issues labelled [`good first issue`](https://github.com/realsamrat/gally/labels/good%20first%20issue) and [`help wanted`](https://github.com/realsamrat/gally/labels/help%20wanted) are good places to start.
- **Improve the docs.** If something in the README or `docs/` confused you, it will confuse the next person too.
- **Share an idea.** Post it in [Ideas](https://github.com/realsamrat/gally/discussions/categories/ideas). Questions go in [Q&A](https://github.com/realsamrat/gally/discussions/categories/q-a).

## What fits, and what doesn't

Gally is photo-first. It stays focused on photos, camera movement, layouts, image loading and renderers.

These fit:

- Bug fixes, and fixes to how a gesture or a transition feels
- Performance work, with numbers
- Better image loading, layouts and renderers
- Accessibility: keyboard use, focus, screen readers, reduced motion
- Docs, examples and tests

These don't, and a PR for one will be closed:

- Whiteboard or editor tools: drawing, arrows, text, sticky notes, generic shapes
- Cursor effects
- App UI inside the engine: headers, navigation, albums, lightboxes, analytics, branding. Those belong in the app that uses Gally.

`AGENTS.md` has the full list, and `CONTEXT.md` has the words the project uses (Photo Tile, Camera, Visible Window and so on). Please use those words in code and docs.

## Before you write code

- **A small fix for an obvious bug** needs no issue. Open the PR.
- **A larger fix** should link the issue that shows the bug.
- **A new prop, a new export or a change in behaviour** should start as an [idea](https://github.com/realsamrat/gally/discussions/categories/ideas) or an issue. Public API is hard to take back, so it's worth agreeing on the shape before you build it. This saves you from writing something that can't be merged.

## Setup

You need Node 22.

```bash
git clone https://github.com/realsamrat/gally.git
cd gally
npm install
npm run fixtures     # download the sample photos the site and playground use
npm run dev:site     # the demo site
npm run dev          # the benchmark playground
```

The README has a map of the [repository](README.md#repository).

## Making a change

Before you open a PR, run:

```bash
npm run typecheck    # package, playground and demo site
npm run build        # the package, into dist
```

- **Commit `dist` with `src`.** People install Gally straight from GitHub, so the built files are part of the repo. If you change anything under `src`, run `npm run build` and commit the result. CI fails when `dist` is out of date.
- **Touching gestures or the library's canvas renderer?** Run `npm run check:gestures` and `npm run check:renderer`. Both drive a local Chrome.
- **Making a performance claim?** Back it with `npm run bench:fps` or `npm run bench:trace`, before and after. [docs/benchmarks](docs/benchmarks) shows how earlier rounds were measured.

## Opening a pull request

- **One problem per PR.** Include everything that fix needs: code, `dist`, docs. Cleanup and unrelated fixes go in their own PRs.
- **Show that it works.** Say how you tested it, on which browser and device, and what you saw. "Typecheck passes" is not enough for anything a person can see or feel.
- **Show what changed.** Visual changes need before and after screenshots. Anything about motion, timing or gestures needs a short recording. Upload them to the PR; don't commit them.
- **Keep it small.** A PR that can be read in ten minutes gets reviewed sooner.

AI-assisted PRs are welcome. Say which model and tool did the work, and test what it wrote yourself. You are responsible for the change, not the model.

## Review

There is one maintainer, so a review can take a few days. A PR that follows this guide can still be declined if it doesn't fit where the project is going. That's about scope, not about you, and you'll get the reason.

## Conduct

Be kind and assume good faith. Critique the code, not the person. The [code of conduct](CODE_OF_CONDUCT.md) has the rest.

## Security

Don't open a public issue for a vulnerability. See [SECURITY.md](.github/SECURITY.md).

## License

Gally is [MIT licensed](LICENSE). By contributing, you agree that your contribution is released under the same license.
