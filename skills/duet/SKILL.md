---
name: duet
description: >-
  Run a high-speed parallel coding and independent code-review workflow via
  Antigravity Swarm where Gemini 4 Carbon acts as Lead Coder (spawning parallel
  subagents across disjoint files) and Gemini 4 Argon continuously reviews and
  verifies every slice. Use when the user invokes /duet or asks for parallel
  dual-model coding and code review.
---

# Duet — Parallel Lead-Coder & Independent Reviewer Workflow (`/duet`)

Orchestrate a high-throughput **Lead Author + Parallel Subagents (`gemini-4-carbon-high`) ↔ Independent Verifier (`gemini-4-argon-high`)** pipeline using Antigravity's native Swarm so multi-file coding and rigorous verification run concurrently without file or lockfile collisions.

## Decision Tree: Topology Sizing

Before spawning workers, inspect the request scope and pick the leanest topology that maximizes speed without file conflicts:

- **Small Scope (1 file or tightly coupled function refactor)**
  - Spawn `1` `@coder` (`gemini-4-carbon-high`, edits directly without subagents) + `1` `@reviewer` (`gemini-4-argon-high`).
- **Medium Scope (≥ 2 independent files/components in one codebase)**
  - Spawn `1` Lead `@coder` (`gemini-4-carbon-high`, defines shared contracts first, then fans out parallel subagents per file group) + `1` `@reviewer` (`gemini-4-argon-high`, streams reviews per completed batch).
- **Large Scope (multiple independent subsystems, e.g., Backend + Frontend + CLI)**
  - Spawn domain Lead Coders (e.g., `backend`, `frontend` pinned to `gemini-4-carbon-high`, with `workspace: "share"` if builds/tests collide) + `1` `@reviewer` per 2–4 coders (`gemini-4-argon-high`).

*(Note: Default models are `gemini-4-carbon-high` for coding and `gemini-4-argon-high` for review. If the user explicitly requests different models or effort tiers in their prompt, honor the user's requested models).*

## Step 1: Load Native Swarm Coordinator Rules

Read the built-in `swarm` skill (`SKILL.md`) first and follow every Coordinator invariant:
- Never write project code inline as Coordinator; delegate implementation and verification to the swarm.
- Add `monitor` / `narrator` if and only if `swarm_monitor` / `swarm_narrator` are present in `<skills>` (leave `model` unset on them).
- Always output the exact `open_board` value from the latest `swarm` result on its own line at the end of Turn 1.

## Step 2: Spawn the Duet Roster (Turn 1)

Because `post_message`, `read_board`, and `swarm_wait` become available on the turn *after* the first `swarm{action: "add"}`, spawn the entire initial roster in **Turn 1**:

1. **Title the swarm**:
   ```json
   {"action": "title", "title": "Duet: <concise task name>"}
   ```
2. **Spawn the Lead Coder(s) (`gemini-4-carbon-high`)**:
   ```json
   {
     "action": "add",
     "name": "coder",
     "model": "gemini-4-carbon-high",
     "brief": "You are the Duet Lead Coder running on Gemini 4 Carbon. Spec & Goal: <full self-contained spec, target files, constraints>. Follow the 3-Phase Parallel Protocol:\n1) CONTRACTS FIRST: When the task spans >=2 independent files/modules, define shared types/interfaces/schemas and install any required dependencies ONCE yourself first so lockfiles and contracts are settled.\n2) PARALLEL SUBAGENTS: For >=2 disjoint file groups, spawn parallel subagents in one turn via invoke_subagent(TypeName='self', Model='inherit') — they automatically inherit your model. Assign STRICT disjoint file ownership ('ONLY edit <files>, NEVER touch other files or run package installs/git mutations') and point them to the shared contracts from Phase 1. (Skip subagents for single-file edits.)\n3) INTEGRATE & STREAM TO REVIEWER: After subagents return, run build/typecheck yourself to verify clean integration, then post a milestone summary + changed files + test command tagging @reviewer on the board, while immediately continuing to the next milestone in disjoint files. Never edit files currently under @reviewer inspection until @reviewer replies. If @reviewer reports [BLOCKER]/[MAJOR] issues across disjoint files, fan out parallel subagents again to fix them rapidly."
   }
   ```
3. **Spawn the Independent Reviewer(s) (`gemini-4-argon-high`)**:
   ```json
   {
     "action": "add",
     "name": "reviewer",
     "model": "gemini-4-argon-high",
     "workspace": "inherit",
     "brief": "You are the Duet Independent Reviewer & Verifier running on Gemini 4 Argon. Spec & Quality Bar: <full acceptance criteria>. Strictly READ-ONLY on project source files: NEVER edit files owned by @coder. Whenever @coder tags you for a completed slice/milestone, inspect diffs and cross-module contracts, run tests/typechecks/linters, and audit correctness, edge cases, security, and maintainability. For large multi-file batches, you may spawn parallel read-only 'research' subagents (Model='inherit') to audit separate files concurrently. Reply directly to @coder with [BLOCKER], [MAJOR], or [NIT] findings citing board #seq numbers. Do NOT wake @coordinator on intermediate rounds — tag @coordinator with [APPROVED] only when all slices pass verification (or escalate if blocked on a product decision)."
   }
   ```
4. **Spawn `monitor` / `narrator`** if available in `<skills>`, display `open_board` on its own line, briefly summarize how Duet split the task, and end Turn 1.

## Step 3: Coordinate & Land Cleanly

1. On wakeup, call `read_board` and `swarm{action: "status"}`.
2. Let `@coder` and `@reviewer` iterate peer-to-peer on the board; step in on `[APPROVED]`, a scope/product escalation to `@coordinator`, or a `@monitor` `[stall]`.
3. If any coder worked in `workspace: "share"` or `"branch"`, verify approved commits are cleanly merged into the primary workspace **before** calling `swarm{action: "kill"}`.
4. If either pinned model hits quota exhaustion, inspect `swarm{action: "models"}`, inform the user, and switch models following the built-in `swarm` quota rules.
5. Once all slices are `[APPROVED]`, post `[done] <summary>` (without `@` mentions) if `monitor` is active, and present a concise summary of what was built and verified.
