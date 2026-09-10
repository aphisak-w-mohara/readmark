<script lang="ts">
  import { validateToken, type TokenKind } from "../core/token";

  interface Props {
    /** Whether this origin has a sign-in backend at all. */
    available: boolean;
    signedIn: boolean;
    token: string | null;
    onToken: (token: string, remember: boolean) => void;
    onForget: () => void;
  }
  let { available, signedIn, token, onToken, onForget }: Props = $props();

  let raw = $state("");
  let remember = $state(false);
  let note = $state<{ kind: "err" | "info"; msg: string } | null>(null);
  let showToken = $state(false);

  const NEW_TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";

  /** What kind of token is in use, so the trade-off stays visible after saving. */
  const kind = $derived.by((): TokenKind | null => {
    const check = validateToken(token ?? "");
    return check.ok ? check.kind : null;
  });

  // The article lives in the label: "an OAuth token", not "a OAuth token".
  const KIND_LABEL: Record<TokenKind, string> = {
    "fine-grained": "a fine-grained token",
    classic: "a classic token",
    oauth: "an OAuth token",
  };

  function save() {
    const check = validateToken(raw);
    if (!check.ok) {
      note = { kind: "err", msg: check.msg };
      return;
    }
    onToken(check.token, remember);
    raw = "";
    note = { kind: "info", msg: "Saved. Paste a pull request URL above." };
  }
</script>

{#if signedIn}
  <div class="auth-state">
    <span class="dot ok"></span> Signed in with GitHub.
    <a class="auth-link" href="/api/auth/logout">Sign out</a>
  </div>
{:else if token}
  <div class="auth-state">
    <span class="dot ok"></span>
    Using {kind ? KIND_LABEL[kind] : "a token"} ending <code>{token.slice(-4)}</code>.
    <button class="auth-link" onclick={onForget}>Forget token</button>
  </div>
  {#if kind === "classic" || kind === "oauth"}
    <p class="auth-warn">
      This token carries write access to everything you can reach on GitHub — a classic token has
      no read-only setting for private repositories. Fine for a quick look; swap it for a
      fine-grained one if you keep using this.
    </p>
  {/if}
{:else}
  <div class="auth-panel">
    {#if available}
      <a class="btn btn-primary auth-signin" href="/api/auth/login?return=/">
        Sign in with GitHub
      </a>
      <p class="gh-hint">
        Signing in keeps the credential in a cookie this page cannot read — the safer of the two
        routes. Reading an organisation's private repositories still needs an owner to approve the
        app for that organisation.
      </p>
      <button class="auth-toggle" onclick={() => (showToken = !showToken)}>
        {showToken ? "Hide" : "Use a token instead"}
      </button>
    {:else}
      <p class="gh-hint">
        There is no sign-in here — either this is the offline build or a self-hosted file, or
        signing in with GitHub is not switched on yet. Paste a token to read pull requests.
      </p>
    {/if}

    {#if showToken || !available}
      <div class="auth-token">
        <input
          type="password"
          autocomplete="off"
          bind:value={raw}
          placeholder="github_pat_…"
          onkeydown={(e) => e.key === "Enter" && save()}
        />
        <button class="btn" onclick={save}>Save</button>
      </div>
      <label class="auth-remember">
        <input type="checkbox" bind:checked={remember} />
        Remember on this device — otherwise the token is forgotten when this tab closes.
      </label>

      <details class="auth-help">
        <summary>How do I get a token?</summary>
        <ol>
          <li>
            Open <a href={NEW_TOKEN_URL} target="_blank" rel="noopener">
              github.com/settings/personal-access-tokens/new
            </a>.
          </li>
          <li>
            <b>Resource owner</b> — yourself, or the organisation that owns the repositories. An
            organisation may not allow these tokens at all, or may send yours to an owner for
            approval; this screen tells you which.
          </li>
          <li><b>Repository access</b> — <i>Only select repositories</i>, then the ones you review.</li>
          <li>
            <b>Permissions → Repository</b> — <b>Contents: read-only</b>, and
            <b>Pull requests: read-only</b> to read a PR or <b>read and write</b> to leave a
            review on one. Nothing else is needed.
          </li>
          <li>Choose a short expiry, generate it, and paste it above.</li>
        </ol>
        <p>
          In a hurry and you use the GitHub CLI? <code>gh auth token</code> prints one that works
          immediately, including for organisations that have already approved the CLI. It carries
          write access to everything you can reach, so use it to try this out, not as your
          arrangement.
        </p>
      </details>

      <p class="gh-hint">
        A stored token is readable by any script running on this page, and this reader renders
        Markdown other people wrote. Keep the scope small and the expiry short — read-only is
        enough unless you want to leave reviews.
      </p>
    {/if}

    {#if note}
      <div class="note {note.kind}">{note.msg}</div>
    {/if}
  </div>
{/if}
