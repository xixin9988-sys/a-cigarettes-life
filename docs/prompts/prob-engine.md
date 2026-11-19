DOMAIN: Unified deterministic Probability Engine (spec Agent 1).

Read docs/agent_preamble.md, docs/PROJECT_BRIEF.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_RULES.md,
src/core/contracts.d.ts, src/core/SharedTypes.ts, src/core/WorldConfig.ts first.

Implement these files in src/probability/:
- RandomProvider.ts: SplitMix64 hash/seed expansion + Xoshiro128** 32-bit PRNG. Pure functions/classes, no Math.random.
- SeedManager.ts: derive independent 128-bit stream states from (lifeSeed, streamId) deterministically; stream ids are arbitrary strings (see docs/ARCHITECTURE.md list).
- RandomStream.ts: state [s0,s1,s2,s3], nextUint32(), next() -> [0,1), exportState()/importState(), draw counts. Deterministic serialisation for save games.
- ConditionEvaluator.ts: evaluate ConditionExpr AST (and/or/not/cmp/flag/contains/always/never) against ProbabilityContext with dotted path resolution; missing paths => false, NaN-safe.
- ModifierResolver.ts: turn ProbabilityModifier[] (add / multiply, optional path+perUnit, optional condition) into AppliedModifier[] with resolved amounts; NaN-safe.
- ProbabilityCalculator.ts: eligibility filtering, final weight = clamp((base + sum(add)) * prod(mult), min, max), NaN/negative => 0, normalise probabilities; prefix-sum + binary search sampler for candidate sets <= 32; Vose alias table for registered static high-frequency distributions (>32).
- ProbabilityRegistry.ts: registry for reusable static weighted distributions (alias tables built lazily, invalidated on change).
- ProbabilityHistory.ts: ring buffer (limit from WORLD_CONFIG.probability.historyLimit) of ProbabilityDecisionRecord.
- CausalTrace.ts: decision graph tracking (parent decision/event ids, decision counter, cause chains) with bounded memory; export/import via persisted traceCounter.
- ProbabilityDebugger.ts: statistics helpers (per-stream draws, distribution counts, chi-square helper, seed comparison, heatmap-ready data) used by the F12 debug UI later.
- ProbabilityEngine.ts: implements IProbabilityEngine exactly (see contracts.d.ts): init(seed, persisted?), ensureStream, hasStream, listStreams, roll, floatRange, intRange, chance, weighted, decide<T>, getHistory, getHistoryForDecision, getStats, replayDecision, evaluateConditions, exportState, importState, simulate<T>.

BEHAVIOUR REQUIREMENTS:
- decide() must: evaluate conditions (reject candidates), apply modifiers, clamp/normalise, sample from the named stream, fill EvaluatedCandidate[] with base/final/probability/modifiers/eligibility, record the decision, return selected result. Zero/negative total weight => deterministic safe fallback (uniform among eligible; if none eligible select first candidate with probability 1 and flag). min/max weight defaults from WORLD_CONFIG.probability.
- Determinism: same seed + same order of draw calls => identical output; export/import state resumes the exact sequence. Adding a new stream or draws in one stream must not change another stream (seed derivation is independent).
- Replay: replayDecision(decisionId) returns the recorded record. simulate(request, samples) draws samples from a scratch clone of the stream state (must not disturb live streams) and returns counts per option id.
- Performance: 100k draws must be fast (<1s) and allocation-light.

TESTS in tests/probability/: determinism.test.ts (repeat/restore), streamIndependence.test.ts, distribution.test.ts (chi-square style tolerance on 60/40 and multi-way weights, e.g. 20k samples), conditions.test.ts, weights.test.ts (clamping, zero, NaN), replay.test.ts, sampling.test.ts. Pass: npx vitest run tests/probability. Also npx tsc --noEmit and fix your files only.
