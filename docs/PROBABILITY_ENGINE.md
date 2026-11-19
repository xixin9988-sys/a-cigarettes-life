# Probability Engine

The single randomness authority of the game (`src/probability/**`). No gameplay code may call
`Math.random()` (enforced by ESLint `no-restricted-properties`).

## Algorithms
- **SplitMix64** hashes (lifeSeed, streamId) into a 128-bit stream state.
- **Xoshiro128\*\*** produces uniform uint32 values converted to `[0,1)` floats and int ranges.
- Each `RandomStream` persists its 4 uint32 state words, so a save/load resumes the exact
  random sequence.
- Candidate sets <= 32 use prefix-sum normalisation + binary search sampling.
- Large static distributions (>32 candidates) use **Vose's alias method** for O(1) draws
  (ProbabilityRegistry caches alias tables).
- Invalid weights (NaN, negative, infinite) are clamped to 0 and reported; if the total weight is
  0 the engine falls back deterministically to a uniform pick among eligible options (and flags
  the decision) instead of throwing.

## Decision pipeline
```
request(streamId, context, candidates, decisionType)
  -> evaluate ConditionExpr per candidate (and/or/not/cmp/flag/contains)
  -> reject ineligible candidates
  -> resolve add/multiply modifiers (static or context path * perUnit)
  -> finalWeight = clamp((base + sum(add)) * prod(mult), minWeight, maxWeight)
  -> normalise probabilities, sample from stream
  -> record ProbabilityDecisionRecord (context, candidates, weights, probability, selected)
  -> return ProbabilityDecision<T>
```
Condition paths resolve JSON paths into `ProbabilityContext` (e.g. `actorState.hunger`,
`environment.weather`, `history.0`).

## Streams
Streams are requested by name and derived independently, so adding draws in one stream cannot
change another stream's sequence. Documented stream ids:

`world.weather`, `world.environment`, `world.transport`,
`npc.behavior`, `npc.social`, `npc.memory`, `npc.schedule`,
`economy.market`, `economy.business`, `economy.customer`, `economy.jobs`,
`farming.growth`, `farming.quality`, `foraging.results`, `fishing.results`,
`fishing.minigame`, `exploration.discovery`,
`crafting.quality`, `cooking.quality`, `collection.discovery`,
`social.interaction`, `social.romance`, `social.dialogue`,
`events.occurrence`, `events.festival`,
`player.opportunities`, `player.cigarettePhysics`, `life.ash`, `life.archive`,
`housing.decor`, `ui.cosmetic`.

## History & debugging
The engine keeps a bounded ring buffer (default 5000) of decision records: decisionId, stream,
decisionType, context snapshot, every candidate's base/final weight and probability, selected id,
timestamp. `ProbabilityDebugger` exposes per-stream statistics, distribution counts, decision
replay lookup and seed comparison. The in-game F12 ProbabilityDebugUI visualises the same data
via `IGameApi.getProbabilityDebug()`.

## Determinism guarantees
- Same life seed + same state + same sequence of decisions -> bit-identical results.
- Export/import state resumes the exact sequence.
- `simulate(request, samples)` uses a scratch clone and does not disturb live streams.
- Tests: `tests/probability/determinism.test.ts`, `distribution.test.ts`, `weights.test.ts`,
  `streamIndependence.test.ts`, `replay.test.ts`.

## Balance principles
No secret luck bonus for the player; no unrecoverable negative lockouts. Systems may implement
soft protection by adjusting weights from history (e.g. consecutive bad events), but every such
adjustment must be visible in the decision record and is implemented via ordinary modifiers.
