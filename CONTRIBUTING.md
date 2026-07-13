# Contributing to agentsentinel

Thanks for wanting to help. This project is small and narrow on purpose, so contributions that fit
that scope are the ones most likely to get merged quickly.

## Scope, read this before you start

Some decisions are settled, and a pull request that reopens one will probably get pushback. Not
because the idea is bad, but because it changes what this project is:

- **No hosted component.** No server, no accounts, no dashboards, no telemetry. Every check runs on
  the user's machine.
- **No paid API calls.** The only network calls are to the free, unauthenticated public npm
  registry and downloads APIs. Anything that would cost money per user is out.
- **No AI or LLM calls.** The detection is deliberately rule based against structured data, which
  is what keeps it fast, predictable, and free.
- **The npm registry only.** That covers npm, pnpm, and yarn, since all three install from it.
  PyPI, Cargo, and others are a possible later addition, not something to add before this has
  proven useful.
- **Thresholds are fixed** at 30 days and 1,000 monthly downloads. Making them configurable is a
  planned later change, not a current one.
- **Warn is the default.** Blocking stays opt in.

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

## Making a code change

1. Fork the repo and create a branch named `type/short-description`, for example
   `fix/scoped-package-parsing`.
2. Keep changes focused. One bug or one small thing per pull request.
3. Add a test if you're changing behavior.
4. Run `npm run lint`, `npm run typecheck`, and `npm test` before opening the pull request.
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
