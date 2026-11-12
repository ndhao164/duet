# Duet

**Duet** is a parallel multi-model coding and verification plugin for **Google Antigravity**, bundled with a **real-time Split-Lane UI Dashboard**. By invoking `/duet`, Antigravity orchestrates a Swarm pairing **Gemini 4 Carbon** (acting as Lead Coder with parallel subagents) and **Gemini 4 Argon** (acting as an independent, read-only Code Reviewer & Verifier).

## How Duet Works

```text
User (/duet <task>)
 └── Coordinator (Swarm Board + Duet Dashboard UI)
      ├── @coder (Gemini 4 Carbon High — Lead Coder)
      │    ├── Phase 1: Lock shared types/interfaces & dependencies once
      │    ├── Phase 2: Fan out parallel Carbon subagents across disjoint files
      │    └── Phase 3: Typecheck/build slice -> stream to @reviewer while coding next slice
      └── @reviewer (Gemini 4 Argon High — Independent Verifier)
           ├── Read-only diff audit + test/linter execution (parallel research subagents on large PRs)
           ├── Peer-to-peer [BLOCKER] / [MAJOR] / [NIT] feedback -> @coder
           └── [APPROVED] sign-off -> @coordinator
```

## Live Duet Dashboard (Bundled UI Sidecar)

Duet ships with a native Antigravity Auxiliary Pane UI (`sidecars/dashboard/`) that visualizes what the default Swarm Board cannot:

- **Carbon Build Lane + Live Subagent Tree**: Automatically inspects `@coder`'s transcript in real time to render every parallel subagent (`invoke_subagent`), its current tool call, step count, and clickable modified file chips.
- **Argon Verification Shield**: Tracks `[BLOCKER]`, `[MAJOR]`, `[NIT]`, and `[APPROVED]` review gates across milestones, automatically marking findings as resolved once re-verified.
- **Interactive Demo Preview**: Includes a built-in 4-stage interactive simulation so you can preview the full pipeline before running your first `/duet` session.

Enable the **Duet** UI sidecar from the plugin page in **Customizations > Installed > Duet** (or open **Duet** from the `+` panel menu in the conversation header).

## Installation

Install directly from GitHub with the Antigravity CLI:

```bash
agy plugin install https://github.com/ndhao164/duet
```

Or install the standalone skill via the Agent Skills CLI:

```bash
npx skills add ndhao164/duet -g
```

## Usage

Type `/duet` followed by your feature, refactor, or bugfix specification in any Antigravity chat session:

```text
/duet Build a JWT authentication middleware, user session store, and integration tests
```

## License

MIT
