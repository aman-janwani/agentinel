# agentinel

Guards your AI coding agent when it installs npm packages.

Coding agents install dependencies on your behalf, often without you looking closely. Sometimes
they install a package that was registered last week with no history, sometimes one whose name they
invented, and sometimes a legitimate package that pulls in a compromised one three levels deep.
agentinel checks every package an install would bring in, at the moment the agent reaches for it,
and tells the agent why something looks wrong so it can back off.

Every other tool in this space guards your terminal. agentinel guards your agent.

## Install

```sh
npm install --save-dev agentinel && npx asen init
```

That sets up a hook for whichever coding agents you use, plus a git pre-commit hook. No account, no
server, no configuration.

You can also try it with `npx agentinel init` and nothing installed, though the agent hook then
resolves through npx on every command, which is slower.

## What it checks

Every package an install would actually bring in, not just the one you named. `npm install express`
looks like one package and installs 67, and most real npm malware hides in the transitive ones.

- **Known malware.** A bundled list of 216,000 packages confirmed malicious (from the open OSV
  database), matched on your machine. Nothing about what you install is ever sent anywhere.
- **npm takedowns.** Packages npm itself has pulled for security.
- **New and unused.** Registered in the last 30 days with under 1,000 monthly downloads, the classic
  slopsquat shape.
- **No track record.** No repository, one version ever, barely downloaded.
- **Sudden bloat.** A patch release that triples the amount of code, paired with a change of
  publisher: the fingerprint of a hijacked maintainer account.

Names that do not exist on npm at all are called out too, since a name an agent invented is exactly
what a slopsquatter waits to register.

Against the 100 most depended-on packages on npm it flags **zero** of them, while catching every
package in its known-bad test set. A security tool that cries wolf gets uninstalled the same day, so
that number is the one that matters.

## Which agents

CLI agents, all through their native pre-execution hook: **Claude Code, Codex CLI, Copilot CLI, and
Gemini CLI**. `asen init` wires up whichever of them it finds on your machine. When it blocks
something in strict mode, the agent is told why in a way it understands, so it looks for a safe
alternative instead of retrying.

For installs that never go through an agent, a person typing `npm i` by hand or a script shelling
out, there is an opt-in shim (`asen init --shim`) that checks those too. And the git pre-commit hook
scans the staged lockfile, so a poisoned dependency cannot slip in through a commit either.

## Warn or block

Warn is the default: it tells you and the agent, and gets out of the way. Set `"mode": "strict"` in
`.agentinel.json` to turn a finding into a block.

## Commands

```sh
npx asen init                            # set up hooks in this repo
npx asen init --shim                     # also guard installs you type by hand
asen check                               # check the staged dependencies now
asen check some-package                  # check a specific package
asen allow <pkg> --reason "why"          # allowlist a package, with a logged reason
asen unshim                              # remove the shim
```

`asen check` exits non-zero when something is flagged, so it works as a CI step.

The allowlist lives in `.agentinel.json` and is committed, so the reason a package was trusted is
visible to everyone on the repo. It is a trail, not a silent bypass.

## How it stays out of your way

agentinel does no network interception. It runs no proxy, changes no TLS settings, and injects no
environment variables. So it cannot break `npm test`, a private registry, or a Rust or Go build, the
way a man-in-the-middle proxy can. The malware list is matched locally and works offline. If the npm
API is unreachable, a check is skipped with a note rather than blocking your work.

## Platforms

macOS and Linux are fully supported. Windows works too: the agent hooks and the git pre-commit hook
run, and the optional shim installs as a PowerShell-friendly wrapper. Windows is written and covered
by tests but has had less real-world use than macOS and Linux, so if something misbehaves there,
please open an issue.

## Scope

The npm registry only, which covers npm, pnpm, yarn, and bun, since they all install from it. Not a
CVE scanner, that is what `npm audit`, Snyk, and Dependabot are for. This finds malicious packages,
not vulnerable-but-legitimate ones.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
