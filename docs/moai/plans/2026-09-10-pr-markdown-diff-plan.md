# PR markdown diff review — implementation plan

Spec: [2026-09-10-pr-markdown-diff-design.md](../specs/2026-09-10-pr-markdown-diff-design.md)

Bottom-up: pure core first, each step green before the next. One commit per step.

| #   | Step                     | Files                                                                            | Done when                                                                     |
| --- | ------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | Extract the block walker | `core/blocks.ts`, `core/markdown.ts`                                             | `parseBlocks` renders from `splitBlocks` output; existing 41 tests still pass |
| 2   | Block alignment          | `core/align.ts`                                                                  | Rewrap yields all `same`; 3-word edit yields one `changed`                    |
| 3   | Word diff + render       | `core/diff.ts`                                                                   | `toDiffHtml(x, x)` === `toHtml(x)`; no split inside links                     |
| 4   | Token storage            | `core/token.ts`                                                                  | Shape check, session vs local store, clear wipes both                         |
| 5   | PR resolution + fetch    | `core/pr.ts`                                                                     | URL table, markdown filter, pagination, faked fetch                           |
| 6   | Auth seam                | `lib/gh.ts`                                                                      | Session → proxy, token → `api.github.com` + Bearer, never in URL              |
| 7   | Pages Functions          | `functions/api/**`                                                               | OAuth exchange, allowlisted GET proxy, refresh on 401                         |
| 8   | State + entry            | `state.svelte.ts`, `components/SourceModal.svelte`                               | PR URL opens diff mode; auth panel when no credentials                        |
| 9   | Diff UI                  | `components/PrBar.svelte`, `components/DiffView.svelte`, `App.svelte`, `app.css` | Layout × scope toggles, change nav, ins/del in all 5 themes                   |
| 10  | Docs + verify            | `README.md`                                                                      | `bun test`, `lint`, `check` green; diff verified in the browser               |

## Notes

- Step 1 is a refactor of existing code, not new behaviour. The existing tests are the safety net — if they go red, the extraction is wrong.
- Steps 2–6 are pure and get tests in the same commit. Steps 7–9 are IO and view; they get verified in the browser at step 10.
- Step 7 cannot be exercised locally without `wrangler` and a registered GitHub App. Handlers stay thin, with the decision logic (`isAllowed`, `shouldRefresh`) pulled into tested pure helpers.
- The org token-policy unknown from the spec does not block any step: `lib/gh.ts` takes whichever credential works.
