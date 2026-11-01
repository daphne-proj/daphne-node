# Intentions calibration, rubric v2

These six PRs are known development cases, not an unseen benchmark or a runtime answer key. The examples were checked against the saved source packets during implementation. They are proposed standards for human validation; disputed materiality remains explicit. Neither runtime prompts nor ordinary judge packets include these expected answers. Historical rubric-v1 reports remain unchanged and are not reparsed under v2 consistency rules.

## Frozen provenance

Repository: `daphne-proj/pr-review-test`. Every selected run has BASE/target `3f0d15e8834c098d26b428bad1b325e6f33d9755`.

| PR                                                        | HEAD                                       |
| --------------------------------------------------------- | ------------------------------------------ |
| [1](https://github.com/daphne-proj/pr-review-test/pull/1) | `93076efe37909ef3f36480170048cc9387aa29be` |
| [2](https://github.com/daphne-proj/pr-review-test/pull/2) | `1530d7b5e99e4ad67a12164e3c605503c1ec0998` |
| [3](https://github.com/daphne-proj/pr-review-test/pull/3) | `7c19811d7825902925c6e98ef13ea903bc3fe42d` |
| [4](https://github.com/daphne-proj/pr-review-test/pull/4) | `410da83eaee97864746415247d1bfbf0f559381c` |
| [5](https://github.com/daphne-proj/pr-review-test/pull/5) | `120de9bccd977c6aa3d7f2043fcb62fcaef0759f` |
| [6](https://github.com/daphne-proj/pr-review-test/pull/6) | `9c7f14214bb297c96d38b935b01e253266054619` |

Paths below use `A = outputs/intentions-improvement-comparison-2026-10-31T133124Z` and `B = outputs/intentions-pr456-normal-2026-10-31`, relative to the repository root. These ignored artifacts support provenance; the default test suite must not depend on their availability. Evidence IDs are local to each run; source byte ranges below are half-open.

| Artifact                             | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| A/pr-1-run-2/run.json                | `12c2faaaf48ce586ff4888b1b1b0b4dc126b43e5cb277e67694ea20995823d6e` |
| A/pr-1-run-2-final-judge/report.json | `2232d93c0a52dd7366afd129b3ffb91057571c904d4e7356c7bbc7d2545fd3cd` |
| A/pr-2-run-1/run.json                | `d1a86272900b7247909c6ab22898cd16e6016826ccfa3db56e1e83f4fcb013cc` |
| A/pr-2-run-1-final-judge/report.json | `b46b6b9e7277db39964ca7e6134ab1c5e23cce01e629c7cabd9b04391c5ff6c1` |
| A/pr-3-run-1/run.json                | `0e99956baf1f80898145361916983de19c846344010cd9ff1c681be6fae350c2` |
| A/pr-3-run-2/run.json                | `5f76446ebbdfd340bd545f8cb7fc1866d37a8db2b5e9298008b3857ae5a7ae56` |
| B/pr-4-run-1/run.json                | `e4f5df9d738160c98823a63bade3eaa8d052ea58aa29516f3cf19bdba0a78196` |
| B/pr-4-run-1-first-judge/report.json | `d9f7983ecd19ed08aa4b4b8253e7a751c7d560108902f4265e15b9b82d0f62b6` |
| B/pr-5-run-1/run.json                | `762a4751dbe6ee3b0d5e5b37bccf75dbeae2eb999a29849a740839e3518bdd43` |
| B/pr-5-run-1-final-judge/report.json | `c9d706ebee5b39b38242e16fdb8a44cd6ab39c469ce0cb7d65262c7bf7be3f9e` |
| B/pr-6-run-1/run.json                | `430bfe92246b6bf06322fab7f6ec0f8056c7f628f6f88a01ce7b7f41899ad3ca` |
| B/pr-6-run-1-final-judge/report.json | `e169f007ae9e1362ac5866e0a960699e7768b33d2163606122e6ee4e95188131` |

## PR 1: wrong title and claim-dependent support

In run 2, candidate 1, card 1 says “Require an API key and provide a worker retry entry point.” `apps/api/src/idempotency-header.ts` (evidence-21) requires an **idempotency key**, not an authentication API key. This is a confirmed title contradiction. “Require an idempotency key…” is an acceptable correction. An advisory label cannot waive the defect under the new policy.

The same card's after field says “authenticated tenant ID.” Attached HEAD evidence-18 `[293,444)` and evidence-20 `[491,638)` in `checkout-handler.ts` omit `const actor = requirePrincipal(principal)`. Full HEAD evidence-78 `[0,644)` supports the claim; BASE evidence-77 `[0,443)` shows authentication already existed. The citation gap depends on the actual claim. Attaching the relevant support or narrowing the claim is acceptable; unchanged authentication need not be narrated or cited in every explanation.

Card 3 describes escaping, money formatting and status badges. Evidence-10 in `order-table.ts` shows calls to `escapeHtml`, `formatMoney` and `renderStatusBadge`; evidence-5/7/12 contain helper implementations. Detailed claims about internals need implementation support. A statement that the table calls these helpers can be supported by the call sites. Blanket demands to expand every conventional helper call are disputed and are not calibration requirements.

## PR 2: adequate refactor control

Run 1 explains `calculatePrice` with the preserved `price` alias, the moved fake gateway with forwarding export, and the checkout-local promotion helper. Supporting anchors include evidence-12 (`packages/checkout/src/pricing.ts`, HEAD `[0,959)`), evidence-2/3 (gateway forwarding and implementation) and evidence-10 (`promotion.ts`, HEAD `[0,310)`). BASE evidence-13 (`packages/core/src/money.ts`, `[0,662)`) contains the same discount formula and bounds.

The historical finding concerns card 2's **why**: its attached HEAD evidence does not establish that the promotion logic is unchanged from BASE. Preserve that rationale diagnostic, but do not fail primary citation support for a why-only issue. Qualified inference or unknown motivation are acceptable. The supplied primary explanation is a positive control, not proof that every possible defect has been excluded.

## PR 3: wrong operation versus a sufficient short citation

Run 1, card 2 before claims delivery bookkeeping deduplicated writes by event ID. Its evidence-35 (`delivery-log.ts`, BASE `[258,362)`) only implements `has(eventId)`. Evidence-33 `[193,253)` establishes insertion deduplication with `if (!this.has(entry.eventId)) this.records.push(entry);`. HEAD evidence-34 `[263,339)` changes that guard to tenant/event pairing. This is a confirmed citation gap: attach the insertion guard or narrow the claim to membership lookup.

Run 2 supplies evidence-53 (`outbox.ts`, BASE `[489,615)`) and evidence-54 (HEAD `[585,800)`) for `markDelivered` changing record selection from event ID to tenant/event pair. These ranges suffice for the lookup-key transition. Requiring unchanged delivered-state mutation or missing-record handling is disputed for a claim confined to lookup. Those lines become relevant if the field also asserts mutation or failure behavior. No mandatory whole-function expansion follows from this example.

## PR 4: absence scope, deployment constraint and failed result

Candidate 1, cards 1/2 before claim no deployment/test scripts existed. BASE evidence-23 (`package.json`, `[234,293)`) shows only the build entry. It cannot establish absence elsewhere in the scripts object. The reviewer obtained evidence-42, full BASE `package.json` `[0,353)`; candidate 2 substituted it in both citations without changing prose. This is a confirmed support repair. Narrowing the claim to the shown command would also be acceptable if meaningful coverage remains intact.

HEAD evidence-14 (`docs/deployment.md`, `[0,2069)`) requires one packaging process per checkout because build output is shared. This is a consequential caller constraint; one sentence in an existing card is sufficient. The proposed omission concerning `npm test → integration packaging → archive upload` has disputed materiality: the cards explain the constituent operations, and their relationship may already be inferable. Require clarification only if the explanation misleads about artifact production. Calling a script “executable” also requires the correct mode metadata (`change-7`, `100755`), not shell contents alone.

The next review failed with “OpenAI request failed, timed out or was cancelled.” That message does not prove a specific timeout. The host artifact is failed and contains no accepted candidate. Candidate 2 is a diagnostic draft, even though the support repair is visible; it must not contribute an accepted-output success.

## PR 5: adequate feature control

The cards cover validated availability/report paging and all-match summaries, authenticated CSV queries, independent cart quotation and exact arithmetic. Anchors include evidence-15 (`inventory-report-query.ts`), evidence-11 (`inventory-report-handler.ts`), evidence-14 (`inventory-report-export.ts`), evidence-19 (`cart-quote.ts`), evidence-42 (full HEAD `pricing.ts`) and evidence-45 (full HEAD `money.ts`).

Historical accuracy, citations, coverage and coherence are all 2; rationale is 1. The sole finding is card 0's why using a feature quotation as explicit motivation. A new v2 assessment with clean primary dimensions should pass primary quality while preserving the rationale issue. Qualified inference or unknown motivation is acceptable; no exact prose or card count is required.

## PR 6: detected contradiction and semantic coverage

Card 2 after says “Reservations are copied before query validation…” Evidence-28 (`packages/catalog/src/inventory.ts`, HEAD `[4338,4847)`) executes `validateReservationQuery(query);` before `const rows = this.reservations();`. The runtime reviewer detected this as advisory accuracy, yet v1 accepted. This confirmed contradiction must request correction under v2 regardless of severity. “Validate the query, then copy reservations before expiry checks, filtering and sorting” is acceptable. A new judge report cannot pair this before/after contradiction with citations=2 or a null accuracy/citation score.

Card 0 after describes detached adjustment receipts and already cites evidence-45/47 in `stock-ledger.ts`. Evidence-45 `[633,1250)` copies **all incoming entries** in `recordMany`; evidence-47 `[1279,1776)` returns copied objects from general entry listing as well as adjustment receipts. The broader ownership/aliasing change remains unexplained. A concise sentence such as “The ledger copies entries when recording and listing them, including ordinary stock movements” covers the behavior without requiring a new card.

An exact quote about adjustment receipts can pass structural coverage checks while failing to explain general ledger copying. Coverage validation proves reference integrity, not entailment. The reviewer must mark that broader behavior omitted unless actual text explains it, even when the relevant hunks are already cited.

Evidence-18 (`inventory.ts`, HEAD `[972,2305)`) rejects empty adjustment arrays. This is a real caller constraint, but its standalone materiality is smaller and disputed relative to ledger ownership. Do not silently weight the two omissions equally or invent a requirement to describe every guard.
