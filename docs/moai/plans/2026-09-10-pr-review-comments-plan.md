# PR review comments — implementation plan (Phase 2)

Spec: [2026-09-10-pr-review-comments-design.md](../specs/2026-09-10-pr-review-comments-design.md)

Bottom-up as before: the anchor is the hard part, so it is settled in pure code with tests before any UI exists.

| #   | Step              | Files                                                       | Done when                                                    |
| --- | ----------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Patch parsing     | `core/patch.ts`                                             | Commentable lines per side, from real hunk shapes            |
| 2   | Anchors on rows   | `core/diff.ts`, `core/pr.ts`                                | `DiffRow.anchor`; `PrFile.patch` carried through             |
| 3   | Draft + payloads  | `core/review.ts`                                            | Add/edit/remove; review and single-comment bodies            |
| 4   | Write calls       | `core/pr.ts`                                                | `submitReview`, `postComment` over the injected fetch        |
| 5   | Store wiring      | `state.svelte.ts`                                           | Draft survives file and range switches, cleared on PR change |
| 6   | The box           | `components/CommentBox.svelte`                              | Anchor label, Write/Preview, three actions                   |
| 7   | The bar + margin  | `components/ReviewBar.svelte`, `DiffView.svelte`, `app.css` | `+` on anchored blocks only, draft markers, submit bar       |
| 8   | Errors + keyboard | across                                                      | 403/422 keep the draft; `c` / `Esc` / `⌘↵`                   |
| 9   | Docs + verify     | `README.md`                                                 | Suite green; verified against a real PR                      |

## Notes

- Steps 1–4 are pure and get tests in the same commit. The anchor tests are the ones that matter: they encode GitHub's rule, which is the thing that will otherwise be discovered at submit time.
- `core/diff.ts` must stay pure — it takes the commentable-line set as an argument rather than reaching for a patch.
- Nothing in `functions/` changes: sign-in is off, so writes go direct with the token.
- Verification against a live PR needs a token with **Pull requests: write**, and a repository where posting a review is acceptable — this repo's own PRs, not a public one.
