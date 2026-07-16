# Contributing to agentinel

Thanks for wanting to help. This project is small and narrow on purpose, so contributions that fit
that scope are the ones most likely to get merged quickly.

## Scope, read this before you start

Some decisions are settled, and a pull request that reopens one will probably get pushback. Not
because the idea is bad, but because it changes what this project is:

- **No hosted component.** No server, no accounts, no dashboards, no telemetry. Every check runs on
  the user's machine. Nothing about what a user installs ever leaves their machine.
- **No paid API calls.** The only network calls are to the free, unauthenticated public npm
  registry and downloads APIs. The malware list is the open OSV feed, bundled into the package and
  matched locally, not a paid or phone-home API. Anything that would cost money per user, or send a
  user's install list to a server, is out. This is a hard line, do not chase detection freshness by
  crossing it.
- **No AI or LLM calls at runtime.** Detection is rule based against structured data (registry
  metadata, download counts, the local malware list), which is what keeps it fast, predictable,
  private, and free.
- **The npm registry only.** That covers the `npm`, `pnpm`, `yarn`, and `bun` clients, plus the
  execute-and-download forms (`npx`, `bunx`, `pnpm dlx`), since they all install from the same
  registry. PyPI, Cargo, and others are a possible later addition, not something to add before this
  has proven useful.
- **Signal thresholds are fixed** (for example, younger than 30 days and under 1,000 monthly
  downloads for the new-and-unpopular signal). Making them configurable is a planned later change,
  not a current one.
- **Warn is the default.** Blocking stays opt in.
- **No false positives on popular packages.** A security tool that cries wolf gets uninstalled. Any
  change to the signals must keep `scripts/eval.mjs` green: every known-bad package still caught,
  zero false positives across the most-depended-on npm packages. A new signal that flags a real,
  widely-used package will not be merged, however good it looks on the attack it was meant to catch.

If you want to challenge one of these, open an issue and make the case there before writing code.

Check the open issues before starting anything big, so two people don't build the same thing.

## Reporting a bug

Open an issue with:

- What you ran (the exact command)
- What you expected to happen
- What actually happened, including any error output
- Your OS and Node version

## Suggesting a feature

Describe the problem you're facing, not just the feature you want. This project grew out of
specific real pain, so a clear problem statement is what decides whether something fits here or
belongs in a different tool.

## How the code is laid out

A quick map so you know where things live:

- `src/checks/package-guard/` is the detection core. `evaluate.ts` holds the signal rules as a pure
  function (no network, so it is easy to test), `registry.ts` and `downloads.ts` are the npm API
  clients, `malware.ts` matches the bundled list, `resolve.ts` resolves the full dependency tree,
  and `parse-install.ts` reads package names out of an install command.
- `src/hooks/` is the integration layer: `agents.ts` is one decision engine with a per-agent output
  shape for Claude Code, Codex, Copilot, and Gemini, and `scan.ts` is the single check every entry
  point runs.
- `src/commands/` is the CLI: `init`, `check`, `allow`, and `shim`.
- `src/platform.ts` is the one place operating system differences live. Do not scatter
  `process.platform` checks elsewhere.
- `data/malware-names.json.gz` is the bundled malware list, built by `scripts/build-malware-list.mjs`
  from the OSV feed. `scripts/eval.mjs` is the accuracy gate.

## Making a code change

1. Fork the repo and create a branch named `type/short-description`, for example
   `fix/scoped-package-parsing`.
2. Keep changes focused. One bug or one small thing per pull request.
3. Add a test if you're changing behavior. Prefer driving the real thing over mocking: several real
   bugs here got past unit tests and were only caught by installing the packed tarball and running
   it. The most valuable tests exercise the interface the tool actually ships through.
4. Run `npm run lint`, `npm run typecheck`, and `npm test` before opening the pull request. If you
   touched any detection signal, also run `node scripts/eval.mjs` and make sure it still passes.
5. Write a clear description: what changed and why, not just what.

Commit messages use conventional commits, lowercase, no trailing period, for example
`fix: handle scoped package names in install command parsing`.

## Code style

Write code a new contributor could read without you explaining it out loud. Comments explain the
non obvious "why", not the "what". No unnecessary abstractions. If there are two ways to write
something and one is more impressive but harder to follow, use the plainer one.

## Code of conduct

Be respectful in issues, pull requests, and discussions. Give constructive feedback, criticize the
code or the idea, not the person. Accept that maintainers may decline a change that doesn't fit the
project's scope, and that this isn't personal.

Harassment, insults, personal attacks, publishing others' private information without permission,
or any conduct that would reasonably be considered inappropriate in a professional setting is not
acceptable. Maintainers may remove comments, close issues or pull requests, or ban contributors who
violate this, at their discretion.

If you experience or witness unacceptable behavior, open an issue or contact the maintainer
directly. Reports will be handled privately and taken seriously.

## License

By contributing, you agree your contribution is licensed under this project's MIT license, see
`LICENSE`.
