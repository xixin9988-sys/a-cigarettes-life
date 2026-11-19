# Agent preamble (read this first)

You are a senior game developer agent on **A Cigarette's Life / 《香烟的一生》**.
Project root: `repo-root` (Windows). You share the filesystem with the Lead (`lead`) and other
agents. The project is already scaffolded: npm dependencies installed, strict TS configured.

## Read in this order (use the read tool)
1. `docs/PROJECT_BRIEF.md` - what the game must be.
2. `docs/ARCHITECTURE.md` - layering, state ownership, update loop, worker model, streams.
3. `docs/DEVELOPMENT_RULES.md` - coding + testing rules (all mandatory).
4. `src/core/contracts.d.ts` - the frozen interface contract. Implement it exactly.
5. `src/data/schema.ts` - static content definition types.
6. `src/core/SharedTypes.ts`, `src/core/WorldConfig.ts`, `src/core/TimeUtil.ts`,
   `src/core/utils.ts`, `src/core/InventoryUtil.ts`, `src/core/RelationshipUtil.ts`,
   `src/core/ContentRegistry.ts`, `src/core/WorldFactory.ts`.
7. The stub files inside your write scope (they exist and must be replaced/expanded).
8. The relevant domain sections of the source spec:
   `life.txt` (2900 lines) and
   `code_artifact.txt` (418 lines, algorithm/file-tree spec).

## Workflow
1. If a shared task id is given in your prompt: `team_task_get` -> `team_task_update` action
   `claim` with the revision. If the team task tools are not available, ignore this step.
2. Study the contract + existing code, then design your module.
3. Implement all files, data and tests in your exclusive write scope. Write real code - no
   placeholders, no fake data, no dead buttons, no "`TODO`" core paths.
4. Run `npx tsc --noEmit` and fix errors in YOUR files only. Parallel agents' unfinished files
   may still error - never edit them.
5. Run `npx vitest run <your test dirs>` until green.
6. Complete the shared task (if any) and report back.

## Hard rules (summarised; details in DEVELOPMENT_RULES.md)
- **Never edit** `contracts.d.ts`, `SharedTypes.ts`, `data/schema.ts`, `data/index.ts`,
  `data/*/ids.ts`, `core/*.ts` (except files you own), configs, `package.json`,
  `src/main.ts`, `src/core/Game.ts`, `src/core/GameBootstrap.ts`,
  `src/simulation/SimulationRuntime.ts`, `src/workers/**`, `src/persistence/**`, or other
  agents' folders. If the contract blocks you, use a local narrowly-scoped type in your own
  module and report the gap.
- **No `Math.random()`**. All uncertainty goes through `ctx.probability` (or `ctx.rng`) with
  your assigned stream ids. Same seed + same state must reproduce identical results.
- **Strict TypeScript**: no `any`, no `@ts-ignore`, `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` are ON (guard index access; never assign `undefined` to an
  optional property - omit it instead).
- **Layering**: everything outside `src/scenes`, `src/ui`, `src/main.ts`,
  `src/persistence` must be DOM-free and Phaser-free (it runs in a Web Worker). No
  `window`, `document`, `localStorage`, `navigator`, Phaser imports in simulation code.
- **State**: authoritative state lives in `GameState` slices. `init(ctx)` + `update(dtSimSeconds)`.
  `dtSimSeconds` = simulated seconds; 1 sim second = 1 in-game minute at 1x speed. Systems must
  tolerate very large dt during offline catch-up (use absolute timestamps; avoid per-frame
  assumptions; cap heavy work per step).
- **Events**: emit the documented bus events for player-visible changes (money, items,
  relationships, discoveries, events, achievements...).
- **Content**: use canonical ids from `src/data/*/ids.ts`; every referenced id must exist.
  Rich content is required (this is a complete game, not a demo).
- **Tests**: vitest, in your assigned `tests/<domain>/` folder. Real behavioural tests,
  deterministic, headless. Must pass.
- Do NOT run `npm install`, `npm run build`, git commands, or dev servers.
- Be honest. Report unfinished work explicitly; never pretend a stub is complete.

## Final report format
- Implemented: bullet list of features (grouped by file).
- Files created (paths).
- Tests: command + pass counts.
- Known limitations / unfinished items.
- Contract gaps or assumptions the Lead must handle.
- Wiring notes: how the Lead should register/construct your systems (system id, init order
  dependencies, constructor signature, any extra public methods beyond the interface).
