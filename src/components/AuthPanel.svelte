<script lang="ts">
  import { validateToken } from "../core/token";

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

  function save() {
    const check = validateToken(raw);
    if (!check.ok) {
      note = { kind: "err", msg: check.msg };
      return;
    }
    onToken(check.token, remember);
    raw = "";
    note =
      check.kind === "classic"
        ? {
            kind: "info",
            msg: "Saved. That's a classic token — it carries write access to every repository you can reach. A fine-grained token limited to Contents and Pull requests (read) is a much smaller thing to hand a web page.",
          }
        : { kind: "info", msg: "Saved." };
  }
</script>

{#if signedIn}
  <div class="auth-state">
    <span class="dot ok"></span> Signed in with GitHub.
    <a class="auth-link" href="/api/auth/logout">Sign out</a>
  </div>
{:else if token}
  <div class="auth-state">
    <span class="dot ok"></span> Using a token ending <code>{token.slice(-4)}</code>.
    <button class="auth-link" onclick={onForget}>Forget token</button>
  </div>
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
        This copy has no sign-in backend — it's the offline build or a self-hosted file, so there
        is nothing to sign in to. Paste a token to read pull requests.
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
      <p class="gh-hint">
        Use a fine-grained token with <b>Contents: read</b> and <b>Pull requests: read</b>, scoped
        to the repositories you review. A stored token is readable by any script running on this
        page, so keep its scope small and its expiry short.
      </p>
    {/if}

    {#if note}
      <div class="note {note.kind}">{note.msg}</div>
    {/if}
  </div>
{/if}
