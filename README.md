# Duet

**Duet** is a parallel multi-model coding and verification plugin for **Google Antigravity**. By invoking `/duet`, Antigravity orchestrates a Swarm pairing **Gemini 4 Carbon** (acting as Lead Coder with parallel subagents) and **Gemini 4 Argon** (acting as an independent, read-only Code Reviewer & Verifier).

## How Duet Works

```text
User (/duet <task>)
 └── Coordinator (Swarm Board)
      ├── @coder (Gemini 4 Carbon High — Lead Coder)
      │    ├── Phase 1: Lock shared types/interfaces & dependencies once
      │    ├── Phase 2: Fan out parallel Carbon subagents across disjoint files
      │    └── Phase 3: Typecheck/build slice -> stream to @reviewer while coding next slice
      └── @reviewer (Gemini 4 Argon High — Independent Verifier)
           ├── Read-only diff audit + test/linter execution (parallel research subagents on large PRs)
           ├── Peer-to-peer [BLOCKER] / [MAJOR] / [NIT] feedback -> @coder
           └── [APPROVED] sign-off -> @coordinator
```

### Key Features

- **Zero Merge Collisions**: Shared interfaces and package installs happen once upfront before parallel subagents touch strictly disjoint file slices; `@reviewer` is strictly read-only on source files.
- **Pipelined Throughput**: As soon as `@coder` finishes Milestone 1, `@reviewer` audits and tests it concurrently while `@coder` builds Milestone 2.
- **Adaptive Topology**: Automatically scales down to a lean 2-agent loop on single-file tasks to conserve quota, or scales out to multiple domain Lead Coders + Reviewers on large multi-subsystem tasks.

## Installation

Install directly from GitHub with the Antigravity CLI:

```bash
agy plugin install https://github.com/ndhao164/duet
```

Or install from a local clone:

```bash
agy plugin validate --strict ./duet
agy plugin install ./duet
```

## Usage

Type `/duet` followed by your feature, refactor, or bugfix specification in any Antigravity chat session:

```text
/duet Build a JWT authentication middleware, user session store, and integration tests
```

You can also customize model tiers inline if desired (for example, requesting medium effort for faster iterations).

## License

MIT
