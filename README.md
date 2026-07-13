# agentinel

Catches AI hallucinated npm packages before your coding agent installs them.

LLMs suggest package names that don't exist roughly one in five times. Attackers noticed, and
they pre-register the names models commonly hallucinate, then fill them with malware. The attack
has a name now: slopsquatting. When your agent says "I'll install `fast-json-validator-pro`", you
have no way to tell, in that moment, whether it's a real library or a trap someone registered two
weeks ago.

`agentinel` checks two things before the install lands:

- **Age**, when the package was first published to npm
- **Popularity**, how many downloads it got in the last month

If a package is both **under 30 days old** and **under 1,000 monthly downloads**, you get a
warning with the real numbers. Both signals have to trip. A brand new release from an established
maintainer doesn't get flagged, and neither does an old, obscure but legitimate package.

## Install

```sh
npx agentinel init
```

That writes a config file, installs a git pre-commit hook, and registers a Claude Code hook. No
account, no server, no configuration required.

## What it looks like

```
$ Claude is installing: fast-json-validator-pro
⚠ agentinel: fast-json-validator-pro looks suspicious
  registered 9 days ago · 4 downloads/month
  this pattern matches known "slopsquatting" attacks
  → run `asen allow fast-json-validator-pro --reason "..."` to silence this
```

Warn is the default. It tells you and gets out of the way, and it tells Claude too, so the agent
knows the package looked wrong and can suggest an established alternative instead of pressing on.

If you want it to actually stop the install, set `"mode": "strict"` in `.agentinel.json`. Claude
Code then treats a flagged package as a denied permission and looks for another approach.

## Two hooks, so it works either way

- **Claude Code hook** (`PreToolUse`): catches the install command before it runs. Reads `npm`,
  `pnpm`, and `yarn` installs, since all three resolve from the same registry.
- **Git pre-commit hook**: diffs every `package.json` and catches new dependencies on commit,
  including workspace packages in a monorepo. Doesn't care which agent, editor, or human added
  them. If your repo uses husky, the hook is installed where husky points git.

## Commands

```sh
npx agentinel init                   # set up hooks + config in this repo
asen check                               # check staged dependencies now
asen check some-package                  # check a specific package
asen allow <pkg> --reason "why"          # allowlist a package, with a logged reason
```

`asen check` exits non-zero when something is flagged, so it also works as a CI step.

The allowlist lives in `.agentinel.json` and gets committed, so the reason is visible to
everyone on the repo. It's a trail, not a silent bypass.

## This has already happened

- **`react-codeshift`**: a name conflating two real tools (`jscodeshift` and `react-codemod`),
  hallucinated into a batch of AI generated agent skill files that nobody reviewed. By the time a
  researcher defensively claimed the name in January 2026, it had spread to 237 repositories and
  was still getting daily install attempts from autonomous agents.
- **`unused-imports`**: what models suggest instead of the real
  `eslint-plugin-unused-imports`. Someone registered the hallucinated name with a malicious
  payload. It was still pulling roughly 233 weekly downloads even after npm marked it security
  held.

## Design

Everything runs on your machine. The only network calls are to the public npm registry and the
public npm downloads API, both free and unauthenticated. There's no server, no account, no
telemetry, and no LLM call anywhere in the tool. It costs nothing to run and it can't phone home,
because there's nowhere for it to phone.

If the npm API is unreachable, the check is skipped with a note. It fails open. A network hiccup
should never be the reason you can't commit.

## Scope

The npm registry only, which covers npm, pnpm, and yarn since they all install from it. No PyPI,
no Cargo. This is deliberately one narrow check that works, not a general security suite. It isn't
a CVE scanner, that's what Snyk and Socket are for.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests are welcome, but read the scope
notes there first so you don't spend time on something that won't get merged.

## License

MIT. See [LICENSE](LICENSE).
