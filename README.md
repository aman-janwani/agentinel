<div align="center">
  <img src="assets/banner.jpg" alt="Agentinel Banner" width="100%" />

  [![npm version](https://img.shields.io/npm/v/agentinel.svg?style=flat-square)](https://www.npmjs.com/package/agentinel)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
  [![Node.js CI](https://img.shields.io/github/actions/workflow/status/aman-janwani/agentinel/publish.yml?style=flat-square)](https://github.com/aman-janwani/agentinel/actions)
</div>

<br />

> **The zero-cost, locally-run package guardrail for your AI coding agents.**

*Agentinel guards your AI agent when it installs npm packages, catching hallucinated dependencies, slopsquatting, and malicious packages before they execute on your machine.*

---

## 📖 The Problem

AI coding agents (like Claude Code, Copilot, or Cursor) install dependencies on your behalf, often while you aren't looking closely. 
- Sometimes they install a package that was registered last week with no history. 
- Sometimes they install a package whose name they entirely **hallucinated**. 
- Sometimes, they install a legitimate package that pulls in a compromised one three levels deep.

**Agentinel** checks every package an install would bring in, at the exact moment the agent reaches for it. It evaluates the package against a bundled, locally-run database of over 216,000 known malicious packages and zero-cost registry heuristics. It then tells the agent why something looks wrong so the AI can back off and reconsider.

Every other tool in this space guards your terminal. **Agentinel guards your agent.**

---

## ⚡ Features & Security Philosophy

- **Zero-Cost & Private:** Agentinel does no network interception, runs no cloud proxies, and requires no paid APIs. The malware list is matched locally.
- **Deep Tree Scanning:** Checks every package an install would *actually* bring in, not just the one named. (`npm install express` brings in 67 packages. We check all 67).
- **Known Malware:** Bundles a local OSV database of 216,000+ confirmed malicious packages.
- **Zero False Positives on Popular Packages:** Tested against the top 100 npm packages.
- **Heuristic Scanning:** Flags npm takedowns, packages under 30 days old with < 1k downloads (slopsquatting), publisher drift, and non-existent hallucinated names.
- **Fails Open:** Designed so that if it crashes or can't reach the registry, it fails open. It will never permanently wedge your terminal or block your work.

---

## 🚀 Installation

Install it as a dev-dependency in your repository:

```sh
npm install --save-dev agentinel
npx asen init
```
*(No account, no server, no complex configuration.)*

---

## 🤖 1. Agentic Use (Native Hooks)

Agentinel wires itself directly into the native pre-execution hooks of popular CLI agents: **Claude Code, Codex CLI, Copilot CLI, and Gemini CLI**. 

When an agent attempts to run `npm install`, Agentinel intercepts the event (e.g., `PreToolUse` for Claude) and scans the requested dependency tree. 

### How it feeds back to the AI
If Agentinel flags a package, it feeds the context *back* to the AI agent in a concise format the agent understands, rather than just crashing the terminal.

**Example Intercept:**
```json
{
  "hookEvent": "PreToolUse",
  "action": "BLOCK",
  "reason": "agentinel blocked 'react-router-v7-beta': Package does not exist on npm (hallucination)."
}
```
The AI reads this, realizes the package is fake or malicious, and intelligently searches for the correct alternative instead of blindly retrying.

---

## 🧑‍💻 2. Normal / Human Use (The Shim)

What about installs that never go through an agent? (e.g., You typing `npm install` manually). 

Agentinel provides an opt-in **PATH shim**. 

```sh
npx asen init --shim
```

This puts a tiny, fail-open wrapper script earlier in your `PATH`. When you type `npm install`, the shim checks the package first. If it's safe, the real `npm` command runs instantly. 

**Terminal Example:**
```bash
$ npm install left-pad-malicious

⚠️ agentinel warning: left-pad-malicious is 2 days old and has 12 downloads.
This matches the profile of a slopsquatting or malicious package.
```

---

## 🔒 3. The Git Pre-Commit Hook

As a final safety net, `asen init` installs a Git pre-commit hook. 
Before you can commit a change to `package-lock.json`, Agentinel scans the staged lockfile. If a poisoned dependency slipped in somehow, the commit is flagged, ensuring malware never reaches your `main` branch.

---

## ⚖️ Competitors vs. Us

How do we stack up against traditional commercial security scanners?

| Feature | Agentinel (Us) | Commercial Alternatives |
|---|---|---|
| **Cost Model** | **100% Free / Zero-cost** | Monthly Subscriptions |
| **Data Privacy** | **100% Local (No cloud)** | Sends telemetry/code to cloud |
| **Agent Hooking** | **Native (intercepts AI directly)** | Scans terminal post-facto |
| **Feedback Loop** | **Tells AI *why* it failed** | Just blocks the terminal |
| **Setup** | **Zero-config, drop-in** | Requires API keys & accounts |
| **Malware Database** | Local OSV Feed (~216k pkgs) | Proprietary Feeds |
| **Feed Freshness** | *Lags 1-3 days behind OSV* | Real-time / Minutes |
| **Detection Method** | *Version-exact + Heuristics* | Advanced Behavioral Analysis |

*Note: We currently lag slightly on feed freshness (by a few days) and advanced behavioral analysis compared to paid enterprise tools. These are areas we acknowledge and plan to explore and improve in future versions, without compromising our zero-cost, 100% local philosophy.*

---

## ⚙️ Configuration (Warn vs. Block)

By default, Agentinel runs in **Warn Mode**. It alerts you (and the agent) but gets out of the way. 
To strictly block bad packages, change your `.agentinel.json` file to strict mode:

```json
{
  "mode": "strict",
  "allowlist": {}
}
```

---

## 🧰 Command Reference

Here are all the commands you can run via `npx asen <command>`:

### `npx asen init`
Wires up agent hooks and git hooks in the current repo.
```bash
$ npx asen init
✅ Wired up pre-commit git hook.
✅ Wired up Claude Code PreToolUse hook.
```

### `npx asen init --shim`
Wires up hooks AND installs the global PATH shim for human terminal protection.
```bash
$ npx asen init --shim
✅ Shim installed. Native terminal npm commands are now guarded.
✅ Wired up pre-commit git hook.
```

### `npx asen check`
Scans the currently staged dependencies in your lockfile. Exits non-zero if flagged (great for CI/CD pipelines).
```bash
$ npx asen check
Scanning staged dependencies...
✅ All 142 staged packages passed security checks.
```

### `npx asen check <package-name>`
Scans a specific package instantly without installing it.
```bash
$ npx asen check react-router-v7-fake
⚠️ agentinel warning: react-router-v7-fake is 1 day old and has 4 downloads.
This matches the profile of a slopsquatting or malicious package.
```

### `npx asen allow <package-name> --reason "why"`
Adds a package to the allowlist in `.agentinel.json` with a required reason. This provides an audited trail for your team.
```bash
$ npx asen allow my-internal-pkg --reason "Internal company package not on public npm"
✅ Added my-internal-pkg to .agentinel.json allowlist.
```

### `npx asen unshim`
Removes the global PATH shim.
```bash
$ npx asen unshim
✅ Shim removed. Normal npm path restored.
```

---

## 🤝 Contributing & Maintainers

We welcome contributions! 
- Please read our [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct, the zero-cost architecture rules, and the process for submitting pull requests.

**Maintainer:** [Aman Janwani](https://github.com/aman-janwani)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
