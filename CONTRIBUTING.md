# Contributing to Pigeon

Thanks for taking the time to look! Pigeon is a small local-first kanban + MCP project, and contributions are welcome — bug reports, feature ideas, PRs, all of it.

## Quick start

See the [README](README.md) for installation and the first-run setup. The short version:

```bash
npm install
npm run setup   # interactive wizard
npm run dev     # starts on http://localhost:3000 (or 3100 via the launchd service)
```

## Development workflow

- **Branch + PR for everything.** Never push directly to `main`. Default base for new work is `dev`; release branches merge into `main` separately.
- **Branch names** follow `feat/<card>-short-slug`, `fix/<card>-...`, `chore/...`, `docs/...`.
- **CHANGELOG `[Unreleased]`** — release-relevant PRs (anything touching `src/`, `prisma/`, `scripts/`, `docs/`, `docs-site/`, or `package.json`) must add a bullet under `## [Unreleased]` in `CHANGELOG.md`. The `unreleased-entry` job in [`.github/workflows/changelog.yml`](.github/workflows/changelog.yml) enforces this; pure infra/test-only PRs can apply the `skip-changelog` label to bypass.
- Keep CHANGELOG bullets short (~280 chars) and lead with what changed and why. Link the card for forensic detail. The cadence rule lives in `docs/VERSIONING.md`.

## Project structure

For an architectural tour — services, routers, MCP server boundaries, and how the pieces talk — see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). (That doc lands in card #284; if you're reading this before it's merged, the high-level layout is in [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md).)

The headline directories:

- `src/server/services/` — business logic (ServiceResult pattern)
- `src/server/api/routers/` — tRPC routers
- `src/mcp/` — MCP server (separate process, own db.ts)
- `src/components/board/` — board UI
- `prisma/schema.prisma` — data model

## Testing

Before opening a PR:

```bash
npm run test       # vitest run
npm run doctor     # environment + DB sanity check
```

`npm run type-check` (tsc --noEmit) and `npm run lint` are also part of the CI matrix in `.github/workflows/check.yml`.

## Filing issues

Use the forms in [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/):

- **Bug** — include OS, Node version, Pigeon version, repro steps, and the output of `npm run doctor`.
- **Feature** — describe the problem first, then the proposed solution and alternatives you considered.

Blank issues are disabled to keep triage signal high; the templates ask the questions a maintainer will ask anyway.

## PR conventions

- **Commit message format:** `type(#N): subject` — for example `feat(#282): project hygiene scaffolds`. Use the body to explain *why*, not what; the diff already says what.
- **PR description** uses the [pull request template](.github/PULL_REQUEST_TEMPLATE.md): Summary, Test plan, Linked card, Checklist.
- **One card per PR** is the default. Multi-card PRs are okay if they're tightly coupled — call that out in the description.
- **Self-review before requesting review.** Read your own diff in the PR view; it usually catches a quartile of the noise.

## Code of Conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). By participating, you agree to uphold it. Conduct concerns route through the same private channel as security reports — see `CODE_OF_CONDUCT.md` for details.

## A friendly note

Pigeon is a small project run by a junior dev who's leaning on AI for architecture decisions. Suggestions, polish PRs, and "this could be simpler" critiques are all welcome — there's no review committee, just a person trying to keep things tidy. If something feels rough, open an issue and we'll talk it through.
