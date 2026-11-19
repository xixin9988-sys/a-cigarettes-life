# Development Rules (all agents must follow)

## Write scope
Only write files inside your assigned scope (given in your task + spawn prompt). Never edit:
- `src/core/contracts.d.ts`, `src/core/SharedTypes.ts`, `src/data/schema.ts`,
  `src/data/index.ts`, `src/data/*/ids.ts`
- other agents' folders, `package.json`, tsconfig/vite/vitest/eslint configs, `src/main.ts`
- `src/core/Game.ts`, `src/core/GameBootstrap.ts`, `src/simulation/SimulationRuntime.ts`,
  `src/workers/**`, `src/persistence/**`, `src/scenes/**` unless assigned to you.
If a contract gap blocks you: implement a narrowly-scoped local type inside your own module,
report it in your final message, and message the Lead (`send_message` agent `lead`) if
hard-blocked. Do not silently diverge from contracts.

## Coding
- Strict TypeScript. No `any`, no `@ts-ignore`, no non-null assertions unless provably safe.
- `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are ON: guard index access and
  never assign `undefined` to optional properties (use conditional fields instead).
- **No `Math.random()`** - ESLint fails on it. Use `ctx.probability` / `ctx.rng` with your
  assigned streams. Non-gameplay cosmetic randomness may use `ui.cosmetic`.
- No network, no cloud, no new dependencies, no `eval`.
- L0-L3 modules must not import Phaser, DOM globals, `window`, `document`, `localStorage`.
  Only `src/scenes/**`, `src/ui/**`, `src/main.ts`, `src/persistence/**` may.
- Never mutate another system's state slice except documented shared slices (player inventory
  and money via `InventoryUtil`, relationship maps via `RelationshipUtil`). Prefer calling
  the owning system through `ctx.registry.getRequired`.
- Every public method/Iface implementation must conform exactly to `contracts.d.ts`.
- Emit the documented bus events when player-visible state changes (money, items,
  relationships, discoveries, events, achievements...).
- Keep functions small and files reasonably sized; name things clearly; add comments for
  formulas and non-obvious rules. No giant god classes.
- All magic balance numbers should come from `WORLD_CONFIG` (`src/core/WorldConfig.ts`) when
  sensible, or be documented local constants.

## Determinism
Same seed + same action sequence + same state must produce identical results. Never use
wall-clock time (`Date.now`) or unseeded entropy for gameplay. Wall-clock is only for
save timestamps and offline duration.

## Testing
- Put vitest tests in `tests/<your-domain>/`. Use explicit imports from `vitest`.
- Use helper patterns: build a `ContentRegistry` from `CONTENT_PACK`, create a fresh
  `GameState` with `createInitialGameState`, construct a `ProbabilityEngine`, `Clock`,
  `EventBus`, `SystemRegistry` and a context via `createGameContext`. Instantiate your system,
  `init(ctx)` and drive it with `update()` / method calls.
- Test real behaviour, edge cases, math invariants and determinism - not mocks of your own code.
- Your tests must pass: `npx vitest run tests/<your-domain>`.
- Whole-project tests will also include the Lead's integration suite; keep your modules
  instantiable in a headless node environment.

## Verification loop
1. `npx tsc --noEmit` - fix errors in YOUR files. Other agents' in-progress files may error;
   ignore those and never edit them.
2. `npx vitest run tests/<your-domain>` - all green.
3. Re-read your interfaces in contracts.d.ts and confirm every method is implemented.
Do not run `npm install`, `npm run build`, git commands or dev servers (the Lead does that).

## Final report (required)
Reply with a concise report: implemented features, files created (paths), test command +
result, known limitations, contract gaps/assumptions, and anything the Lead must wire.
Be honest - "not implemented" is acceptable and much better than a fake implementation.
