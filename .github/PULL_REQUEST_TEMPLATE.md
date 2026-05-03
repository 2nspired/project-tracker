<!-- Thanks for the PR! Fill in each section — short and concrete is better than long and vague. -->

## Summary

<!-- What changed and, more importantly, *why*. The diff already says what. -->

## Test plan

<!-- Markdown checklist of what you ran / what a reviewer should run. -->

- [ ] `npm run test` green
- [ ] `npm run type-check` clean
- [ ] Manual verification: ...

## Linked card

<!-- Use `Closes #N` for cards this PR fully ships, or `Refs #N` for partial work. -->

Closes #

## Checklist

- [ ] CHANGELOG `[Unreleased]` updated with a bullet referencing the card (or `skip-changelog` label applied for pure infra/test PRs — see `.github/workflows/changelog.yml`).
- [ ] If this PR touches design tokens / variants, the showcase route (`/dev/design`) and the token additions are split into separate PRs so each ships independently.
- [ ] `npm run doctor` passes locally.
- [ ] Self-reviewed the diff in the PR view.
