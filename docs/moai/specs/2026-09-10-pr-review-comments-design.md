# PR review comments — design (Phase 2)

**Date:** 2026-09-10
**Status:** approved, ready to plan
**Follows:** [2026-09-10-pr-markdown-diff-design.md](2026-09-10-pr-markdown-diff-design.md) (Phase 1, shipped)

## Problem

Phase 1 made a pull request's Markdown readable. You still have to go back to GitHub to say anything about it — which means finding the paragraph again, in the patch view, where it was hard to read in the first place.

## Goal

Comment on the paragraph you are reading, collect those comments as one review, and submit it with Approve, Request changes, or Comment — without leaving the reader.

## Non-goals

- **Existing comments and threads.** Reading what others already said, replying, resolving. Phase 3.
- **Suggested changes** (GitHub's ```suggestion blocks).
- **A Markdown toolbar.** Preview covers the uncertainty a toolbar exists to reduce, in an app whose readers write Markdown by hand.
- Commenting on untouched prose, or on files the PR did not change.

## Decisions

| Decision               | Choice                                            | Why                                                                                                                               |
| ---------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| What carries a comment | Blocks the PR changed, and only those             | GitHub rejects a comment on a line outside a diff hunk; the UI should express that rule rather than let you discover it on submit |
| Where you write        | An inline box under the block, GitHub's placement | The block stays in view while you write about it                                                                                  |
| Anchor visibility      | The box names the line — `R94`                    | The anchor is what GitHub stores; hiding it promises precision the API does not keep                                              |
| Submitting             | Batched review, plus a single-comment path        | GitHub's own pairing: a lone typo should not require opening a review                                                             |
| Composing              | Write / Preview tabs, no toolbar                  | We already render Markdown better than the box being typed into                                                                   |
| Backend                | None                                              | Sign-in is off, so writes go direct to `api.github.com` with the token; no Functions or CSRF work                                 |

### Rejected alternatives

- **Comment on any text selection.** Reads best, but unchanged prose sits outside the diff hunks, so those comments would silently degrade to file-level ones — two kinds of comment with different behaviour, and no way to tell which you were making until after.
- **File-level comments only.** Never rejected, trivial to build, and throws away the ability to say which sentence you mean.
- **Post every comment immediately.** No draft state to hold, but it notifies the author once per comment and offers no way to approve or request changes at the end.

## The anchor

This is the whole problem, and it is not "which line is this paragraph on".

A review comment must land on a line **inside a diff hunk**. A hunk header like `@@ -152,25 +152,39 @@` says the new file's lines 152–190 are in the diff; a block starting at line 300 is not, and `POST` will fail. A block's own start line is not reliable either: a long paragraph that was rewrapped and edited can begin several lines before the first line the patch actually shows.

So the commentable lines are read from the patch GitHub already sends with each file:

```
core/patch.ts
  parsePatch(patch: string) -> { right: Set<number>; left: Set<number> }
```

Every added and context line in a hunk is commentable on the right; every removed and context line on the left. Then each row's anchor is its line range intersected with that set:

```ts
interface Anchor {
  side: "RIGHT" | "LEFT";
  line: number; // last commentable line of the block
  startLine?: number; // first, when the block spans more than one
}
```

`anchor === null` means no `+` is offered on that block. A multi-line anchor is passed as `start_line`/`start_side` so the comment highlights the paragraph on GitHub rather than one arbitrary line of it.

Side follows the row: `removed` rows anchor LEFT, everything else RIGHT.

## Architecture

```
src/core/
├─ patch.ts     parsePatch(patch) -> commentable lines per side
└─ review.ts    the draft: add/edit/remove, and the submit payloads

src/components/
├─ CommentBox.svelte   the inline editor: anchor label, Write/Preview, actions
└─ ReviewBar.svelte    pending count, Approve / Request changes / Comment
```

`core/pr.ts` gains `patch` on `PrFile` (already returned by the API, currently discarded) and the two write calls. `core/diff.ts` gains `anchor` on `DiffRow`, computed from an injected commentable-line set so it stays pure.

### The draft

```ts
interface DraftComment {
  path: string;
  side: "RIGHT" | "LEFT";
  line: number;
  startLine?: number;
  body: string;
}
```

Held in the store, keyed by `path:side:line` so a second comment on the same anchor edits the first. It survives switching files and commit ranges within one PR — you review a document, not a file — and is cleared when the PR changes or a review is submitted.

Drafts are **not** persisted across reloads in this phase. A half-written review lost to a refresh is annoying; persisting it means reconciling anchors against a PR that may have moved underneath, which is its own design.

### The two writes

Both go direct to `api.github.com` with the token.

```
POST /repos/{o}/{r}/pulls/{n}/reviews
  { commit_id, event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", body?, comments: [...] }

POST /repos/{o}/{r}/pulls/{n}/comments
  { commit_id, path, line, side, start_line?, start_side?, body }
```

`commit_id` is the head of the range being viewed, so a comment lands on the version actually read. `REQUEST_CHANGES` and `COMMENT` require a body; `APPROVE` does not — the submit bar enforces that rather than letting GitHub reject it.

## UI

**The affordance.** A `+` in the margin of every block with an anchor, and only those. It appears on hover and on keyboard focus, so the reading surface stays quiet.

**The box** opens under the block: `Comment on R94 · README.md`, Write / Preview tabs, and three actions — `Cancel`, `Comment`, and a primary that reads `Start a review` when no draft exists and `Add to review` once one does. Preview renders through the app's own Markdown pipeline, on the paper being read.

**The bar** appears once a draft exists: pending count, `Approve`, `Request changes`, `Comment`. Request changes and Comment open a one-line summary field, since GitHub requires a body.

**Marked blocks.** A block with a saved draft keeps a quiet marker in the margin, so you can find your own comments while scrolling.

**Keyboard.** `c` opens the box on the current change; `Escape` cancels; `⌘/Ctrl+Enter` saves the draft.

## Auth

Needs a token with **Pull requests: write**. That is a real step up from Phase 1's read-only recommendation, and the panel says so where the token is entered.

There is no way to know a fine-grained token's permissions before using them, so the failure is handled rather than predicted: a 403 on submit says the token lacks Pull requests: write and keeps the draft intact, so nothing typed is lost. A 422 (usually an anchor GitHub no longer accepts, because the PR moved) names the file and offers to reload the diff.

## Errors

| Case                                | Behaviour                                                                  |
| ----------------------------------- | -------------------------------------------------------------------------- |
| Token lacks write scope (403)       | Explain the missing permission; draft kept                                 |
| Anchor no longer valid (422)        | Name the file, offer to reload the PR; draft kept                          |
| Submit with no comments and no body | Approve submits alone; Comment and Request changes ask for a summary first |
| Network failure mid-submit          | Draft kept, retry offered — never silently half-sent                       |
| PR closed or merged since loading   | GitHub's error surfaced plainly                                            |

## Testing

Pure `bun test`, in the style of the existing 167.

- **patch.ts** — a single hunk; several hunks; added, removed and context lines; a hunk with no newline at end of file; an empty or absent patch (a renamed file with no content change) yields no commentable lines.
- **anchor computation** — a block wholly inside a hunk anchors to its own range; a block partly outside anchors only to the part inside; a block wholly outside anchors to nothing; a removed block anchors LEFT.
- **review.ts** — adding a second comment to one anchor replaces the first; the review payload carries `start_line` only for multi-line anchors; `APPROVE` without a body is valid while `COMMENT` without one is not.

The submit calls themselves are exercised through the injected `FetchLike`, asserting the request body rather than the network.

## Known ceilings

- **Drafts are lost on reload.** Stated above.
- **One comment per anchor.** Two remarks about the same paragraph must be one comment. GitHub allows several; keying by anchor is what makes editing simple.
- **No reply, no resolve, no sight of existing threads.** Phase 3 — until then you are writing without seeing what others already said, which is a real limitation for a second-round review.
- **No commenting under a commit range.** A range's patch describes that range, and its line numbers belong to the range's head rather than the pull request's, so an anchor taken from it can name a line GitHub's diff does not have — measured at 3 of 22 files on one real range. Reading a range stays fully supported; the affordance simply is not offered, and the bar says so. Supporting it properly means anchoring against the PR head while displaying the range, which is its own piece of work.
- **The comment affordance is hover-only, by decision.** The `+` stays invisible until the row is hovered or the button is focused, which keeps the reading surface quiet at the cost of discoverability: nothing announces that commenting exists, and a touch device has no hover to offer. `c` is the non-pointer route. Revisit if the reader is used on a tablet for review rather than reading.
- **A stale anchor is only discovered at submit.** The diff is a snapshot; if someone pushes while you read, GitHub rejects the anchor and the 422 path handles it.
