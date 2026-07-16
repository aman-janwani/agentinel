# Graph Report - .  (2026-07-16)

## Corpus Check
- Corpus is ~28,745 words - fits in a single context window. You may not need a graph.

## Summary
- 357 nodes · 791 edges · 21 communities (20 shown, 1 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.73)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- CLI Commands & Configuration
- Package Metadata & Concepts
- Evaluation & Validation
- Agent Hooks & Lockfiles
- Network & Registry API
- Command Parsing
- Agent Hooks Configuration
- Init Command & Wiring
- TypeScript Configuration
- PATH Shim Manager
- Development Dependencies
- Output Formatting
- Malware Detection
- Evaluation Scripts
- Documentation & Guidelines
- Prettier Configuration
- CI Configuration

## God Nodes (most connected - your core abstractions)
1. `loadConfig()` - 20 edges
2. `runInit()` - 17 edges
3. `repoRootOrCwd()` - 16 edges
4. `runClaudeCodeHook()` - 15 edges
5. `check()` - 14 edges
6. `compilerOptions` - 13 edges
7. `parseCommand()` - 12 edges
8. `parseSegment()` - 12 edges
9. `scan()` - 11 edges
10. `runCheck()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `CI Check Job` --semantically_similar_to--> `PR Checks`  [INFERRED] [semantically similar]
  .github/workflows/ci.yml → CONTRIBUTING.md
- `main()` --calls--> `runInit()`  [EXTRACTED]
  bin/asen.ts → src/commands/init.ts
- `main()` --calls--> `removeShim()`  [EXTRACTED]
  bin/asen.ts → src/commands/shim.ts
- `runHook()` --calls--> `runAgentHook()`  [EXTRACTED]
  bin/asen.ts → src/hooks/agents.ts
- `runHook()` --calls--> `runClaudeCodeHook()`  [EXTRACTED]
  bin/asen.ts → src/hooks/claude-code.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Core Design Principles** — contributing_no_hosted_component, contributing_no_paid_apis, contributing_no_ai_runtime, contributing_zero_false_positives [INFERRED 0.85]

## Communities (21 total, 1 thin omitted)

### Community 0 - "CLI Commands & Configuration"
Cohesion: 0.13
Nodes (30): argv, main(), runHook(), scan(), collectNames(), DEP_FIELDS, git(), gitJson() (+22 more)

### Community 1 - "Package Metadata & Concepts"
Cohesion: 0.05
Nodes (37): author, bin, asen, bugs, url, description, engines, node (+29 more)

### Community 2 - "Evaluation & Validation"
Cohesion: 0.13
Nodes (24): checkOne(), checkPackages(), Depth, evaluate(), needsRegistryLookup(), publisherDrift(), scanForKnownMalware(), sizeJump() (+16 more)

### Community 3 - "Agent Hooks & Lockfiles"
Cohesion: 0.14
Nodes (20): collectFromDependencies(), collectFromPackages(), packagesInLockfile(), packagesInLockText(), readFileOrNull(), stagedLockfilePackages(), parseAddLines(), Resolved (+12 more)

### Community 4 - "Network & Registry API"
Cohesion: 0.16
Nodes (18): describeFailure(), fetchDownloads(), readDownloadCount(), describe(), get(), isTimeout(), RequestFailed, asRecord() (+10 more)

### Community 5 - "Command Parsing"
Cohesion: 0.16
Nodes (22): CommandIntent, consumedBy(), EXECUTE_COMMANDS, EXECUTE_SUBCOMMANDS, INSTALL_SUBCOMMANDS, isFlag(), isValidPackageName(), LOCKFILE_SUBCOMMANDS (+14 more)

### Community 6 - "Agent Hooks Configuration"
Cohesion: 0.13
Nodes (17): AGENT_KINDS, AgentKind, camelCommand(), check(), describe(), emit(), readStdinJson(), runAgentHook() (+9 more)

### Community 7 - "Init Command & Wiring"
Cohesion: 0.21
Nodes (20): agentHookCommand(), alreadyRegistered(), asRecord(), claudeCodeCommand(), git(), gitHookCommand(), hasLocalInstall(), hooksDirectory() (+12 more)

### Community 8 - "TypeScript Configuration"
Cohesion: 0.10
Nodes (19): bin, ES2022, node, src, test, compilerOptions, esModuleInterop, lib (+11 more)

### Community 9 - "PATH Shim Manager"
Cohesion: 0.23
Nodes (16): InitOptions, addPathLine(), CLIENTS, installShim(), onWindows(), pathLine(), posixShim(), removePathLine() (+8 more)

### Community 10 - "Development Dependencies"
Cohesion: 0.12
Nodes (17): eslint, devDependencies, eslint, prettier, tsup, @types/node, typescript, @typescript-eslint/eslint-plugin (+9 more)

### Community 11 - "Output Formatting"
Cohesion: 0.23
Nodes (14): Banner, days(), describeReason(), downloads(), draw(), formatVerdict(), plainSummary(), plainVerdict() (+6 more)

### Community 12 - "Malware Detection"
Cohesion: 0.27
Nodes (6): hadMalwareOnce(), list(), listPath(), load(), MalwareList, setKnownMalwareForTests()

### Community 13 - "Evaluation Scripts"
Cohesion: 0.25
Nodes (8): caught, check(), classify(), falsePositives, KNOWN_BAD, missed, MUST_BE_CLEAN, skipped

### Community 14 - "Documentation & Guidelines"
Cohesion: 0.25
Nodes (8): Design Scope Rules, No AI at Runtime, No Hosted Component, No Paid API Calls, Zero False Positives on Popular Packages, agentinel, Slopsquatting, Strict Mode

### Community 15 - "Prettier Configuration"
Cohesion: 0.50
Nodes (3): printWidth, singleQuote, trailingComma

## Knowledge Gaps
- **82 isolated node(s):** `singleQuote`, `printWidth`, `trailingComma`, `argv`, `name` (+77 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `parseCommand()` connect `Command Parsing` to `CLI Commands & Configuration`, `PATH Shim Manager`, `Agent Hooks & Lockfiles`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `repoRootOrCwd()` connect `CLI Commands & Configuration` to `PATH Shim Manager`, `Agent Hooks & Lockfiles`, `Agent Hooks Configuration`, `Init Command & Wiring`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Why does `loadConfig()` connect `CLI Commands & Configuration` to `PATH Shim Manager`, `Agent Hooks & Lockfiles`, `Agent Hooks Configuration`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **What connects `singleQuote`, `printWidth`, `trailingComma` to the rest of the system?**
  _82 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `CLI Commands & Configuration` be split into smaller, more focused modules?**
  _Cohesion score 0.13008130081300814 - nodes in this community are weakly interconnected._
- **Should `Package Metadata & Concepts` be split into smaller, more focused modules?**
  _Cohesion score 0.05263157894736842 - nodes in this community are weakly interconnected._
- **Should `Evaluation & Validation` be split into smaller, more focused modules?**
  _Cohesion score 0.12878787878787878 - nodes in this community are weakly interconnected._