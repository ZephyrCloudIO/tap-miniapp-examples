/**
 * Static surface markup. Every dynamic region is filled by the controller with
 * created elements, so text that came from GitHub is never parsed as markup.
 */
const styles = String.raw`
  .ghn, .ghn * { box-sizing: border-box; }
  .ghn {
    /* Mini-app surfaces do not always receive Ze Agency's theme stylesheet.
       Keep the same dark palette and font locally so the surface stays legible. */
    --background: #0b0f16;
    --foreground: oklch(98.48% 0 0);
    --card: #171b26;
    --popover: #1b1f2b;
    --primary: #6657ff;
    --primary-hover: #796cff;
    --secondary: #222735;
    --secondary-hover: #2a3040;
    --muted: oklch(24.48% 0.0023 285.98);
    --muted-foreground: oklch(71.19% 0.0051 286.07);
    --accent: oklch(30.27% 0.0071 285.97);
    --destructive: hsl(0 72% 51%);
    --warning: oklch(75% 0.15 90);
    --success: oklch(50.81% 0.042 165.61);
    --border: rgb(255 255 255 / 16%);
    --input-background: #222633;
    --surface-level-1: #151924;
    --surface-level-1-border: rgb(255 255 255 / 9%);
    --ring: hsl(221 83% 53%);
    background: var(--background, #fafafa);
    color: var(--foreground, #171717);
    display: flex;
    flex-direction: column;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: 1rem;
    height: 100%;
    min-height: 100%;
    width: 100%;
  }
  .ghn-header { position: absolute; right: 2rem; top: 2rem; z-index: 20; }
  .ghn-header > .ghn-title { display: none; }
  .ghn-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    gap: 1.25rem;
    min-height: 0;
    overflow-y: auto;
    padding: 1.25rem;
  }
  .ghn-heading { font-size: 1.125rem; font-weight: 650; margin: 0; }
  .ghn-title { align-items: center; display: flex; gap: .5rem; min-width: 0; }
  .ghn-header-end { align-items: center; display: flex; gap: .5rem; position: relative; }
  .ghn-badge {
    display: none;
    font-size: .6875rem;
    font-weight: 700;
    gap: .25rem;
    padding: .1rem .4rem;
  }
  .ghn-badge[hidden] { display: none; }
  .ghn-dot { background: #fff; border-radius: 50%; display: inline-block; height: .375rem; width: .375rem; }
  .ghn button {
    background: var(--secondary, #f4f4f5);
    border: 1px solid var(--border, #e4e4e7);
    border-radius: .5rem;
    color: var(--foreground, #171717);
    cursor: pointer;
    font: inherit;
    font-size: .9375rem;
    font-weight: 600;
    min-height: 2.75rem;
    padding: .55rem .9rem;
  }
  .ghn button:hover:enabled { background: var(--secondary-hover, #e4e4e7); }
  .ghn button:disabled { cursor: not-allowed; opacity: .5; }
  .ghn button:focus-visible { outline: 2px solid var(--ring, #60a5fa); outline-offset: 2px; }
  .ghn-access-btn {
    background: var(--secondary);
    border-color: var(--border);
    color: var(--foreground);
    gap: .35rem;
    white-space: nowrap;
  }
  .ghn-access-btn:hover:enabled { background: var(--secondary-hover); }
  .ghn-access-btn[data-connected="true"] {
    border-color: var(--border);
    color: var(--muted-foreground);
  }
  .ghn-access-btn[data-connected="true"]:hover:enabled { background: color-mix(in srgb, var(--success, #4ade80) 12%, transparent); }
  .ghn-access-modal {
    background: var(--popover, var(--card, #fff));
    border: 1px solid var(--border, #e4e4e7);
    border-radius: .75rem;
    box-shadow: 0 18px 55px rgb(0 0 0 / 45%);
    display: flex;
    flex-direction: column;
    gap: .5rem;
    max-width: min(29rem, calc(100vw - 2rem));
    min-width: 22rem;
    padding: 1.25rem;
    position: absolute;
    right: 0;
    top: calc(100% + .4rem);
    width: max-content;
    z-index: 100;
  }
  .ghn-modal-header { align-items: center; display: flex; justify-content: space-between; }
  .ghn-modal-close {
    background: transparent !important;
    border: none !important;
    color: var(--muted-foreground, #a1a1aa) !important;
    font-size: .875rem;
    line-height: 1;
    padding: .1rem .35rem !important;
  }
  .ghn-modal-close:hover:enabled { color: var(--foreground, #171717) !important; }
  .ghn-status, .ghn-error { margin: 0; }
  .ghn-status { color: var(--muted-foreground, #71717a); }
  .ghn-error { color: var(--destructive, #f87171); }
  .ghn-error[hidden] { display: none; }
  .ghn-section { background: linear-gradient(135deg, #171b27 0%, #141821 100%); border: 1px solid rgb(255 255 255 / 7%); border-radius: 1.25rem; box-shadow: 0 20px 60px rgb(0 0 0 / 18%); display: flex; flex-direction: column; gap: 1rem; padding: 1.6rem; }
  .ghn-section h2 { font-size: 1.25rem; font-weight: 650; margin: 0; }
  .ghn-section-heading { align-items: center; display: flex; gap: 1rem; }
  .ghn-section-icon { align-items: center; background: linear-gradient(145deg, #30364a, #252b3d); border: 1px solid rgb(255 255 255 / 7%); border-radius: .75rem; color: #c9cce0; display: inline-flex; flex: 0 0 auto; font-size: 1.35rem; height: 3rem; justify-content: center; width: 3rem; }
  .ghn-section-copy { display: flex; flex-direction: column; gap: .2rem; }
  .ghn-section-copy p { color: var(--muted-foreground); margin: 0; }
  .ghn-form { display: flex; flex-wrap: wrap; gap: .75rem; }
  .ghn-form input, .ghn-form select {
    background: var(--input-background, var(--background, #fff));
    border: 1px solid var(--border, #e4e4e7);
    border-radius: .5rem;
    color: inherit;
    flex: 1 1 8rem;
    font: inherit;
    min-width: 0;
    min-height: 2.9rem;
    padding: .6rem .8rem;
  }
  .ghn-form input::placeholder { color: #8e94a8; }
  .ghn-field-title { color: var(--foreground); font-size: .9375rem; font-weight: 650; margin: 0 0 .25rem; }
  .ghn-field-help { color: var(--muted-foreground); font-size: .875rem; margin: 0 0 .75rem; }
  .ghn-repository-form input { flex: 1 1 14rem; }
  .ghn-primary-button { background: linear-gradient(135deg, #6554ff, #563cf2) !important; border-color: #7567ff !important; min-width: 7.25rem; }
  .ghn-primary-button:hover:enabled { background: linear-gradient(135deg, #7668ff, #654eff) !important; }
  .ghn-browse-button { flex: 1 0 100%; }
  .ghn-list { display: grid; gap: .65rem; grid-template-columns: repeat(2, minmax(0, 1fr)); list-style: none; margin: 0; padding: 0; }
  .ghn-chip {
    align-items: center;
    background: var(--muted, #f4f4f5);
    border-radius: .85rem;
    display: flex;
    gap: .4rem;
    justify-content: space-between;
    border: 1px solid rgb(255 255 255 / 8%);
    padding: .4rem .6rem;
  }
  .ghn-chip::before {
    background: var(--muted-foreground);
    content: '';
    display: block;
    flex: 0 0 .875rem;
    height: .875rem;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'/%3E%3C/svg%3E") center/contain no-repeat;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12'/%3E%3C/svg%3E") center/contain no-repeat;
    opacity: .55;
    width: .875rem;
  }
  .ghn-chip button { background: transparent; border: 0; color: var(--muted-foreground); font-size: 1.1rem; min-height: auto; padding: 0 .15rem; }
  .ghn-chip-name { flex: 1; font-size: .875rem; overflow-wrap: anywhere; }
  .ghn-tracking-columns { align-items: start; display: grid; gap: 1.5rem; grid-template-columns: 1fr 1fr; }
  .ghn-tracking-right { display: flex; flex-direction: column; gap: .75rem; }
  .ghn-poll-form { align-items: center; border-top: 1px solid rgb(255 255 255 / 10%); flex-wrap: nowrap; padding-top: 1rem; }
  .ghn-poll-form::before { color: #b7bbcf; content: "◷"; flex: 0 0 auto; font-size: 1.25rem; line-height: 1; }
  .ghn-poll-form label { flex: 1; }
  .ghn-poll-form select { flex: 0 1 12rem; }
  .ghn [hidden] { display: none !important; }
  .ghn-picker { background: var(--surface-level-1, var(--card, #fff)); border: 1px solid var(--surface-level-1-border, var(--border, #e4e4e7)); border-radius: .75rem; display: flex; flex-direction: column; gap: .5rem; padding: .75rem; }
  .ghn-picker p { margin: 0; }
  .ghn-picker-list { display: flex; flex-direction: column; gap: .15rem; list-style: none; margin: 0; max-height: 16rem; overflow-y: auto; padding: 0; }
  .ghn-picker-list label { align-items: center; border-radius: .375rem; cursor: pointer; display: flex; gap: .45rem; padding: .2rem .3rem; }
  .ghn-picker-list label:hover { background: var(--muted, #f4f4f5); }
  .ghn-picker-list input:disabled + span { opacity: .5; }
  .ghn-tag { border: 1px solid var(--border, #e4e4e7); border-radius: 999px; color: var(--muted-foreground, #71717a); font-size: .6875rem; font-weight: 600; padding: .1rem .45rem; text-transform: capitalize; }
  .ghn-count { color: var(--muted-foreground, #71717a); font-weight: 600; }
  .ghn-pulls { border: 1px solid rgb(255 255 255 / 7%); border-radius: .8rem; display: flex; flex-direction: column; overflow: hidden; }
  .ghn-pulls-group { display: contents; }
  .ghn-pulls-group h3 { display: none; }
  .ghn-pull { align-items: center; background: rgb(10 13 20 / 20%); border-bottom: 1px solid rgb(255 255 255 / 8%); display: grid; gap: 1rem; grid-template-columns: 17rem minmax(0, 1fr) 14rem 2.5rem; min-height: 4.6rem; padding: .8rem 1rem; }
  .ghn-pull:last-child { border-bottom: 0; }
  .ghn-pull:hover { background: rgb(255 255 255 / 3%); }
  .ghn-pull p { margin: 0; overflow-wrap: anywhere; }
  .ghn-pull-repository { color: #c9cbd7; }
  .ghn-pull-repository span { color: var(--muted-foreground); display: block; font-size: .8rem; margin-top: .2rem; }
  .ghn-pull-main { display: flex; flex-direction: column; gap: .25rem; }
  .ghn-pull-title { align-items: center; display: flex; flex-wrap: wrap; font-size: .875rem; font-weight: 600; gap: .35rem; }
  .ghn-pull-relations { display: flex; flex-wrap: wrap; gap: .35rem; justify-content: flex-end; }
  .ghn-review-state { align-items: center; border: 1px solid; border-radius: 999px; display: inline-flex; font-size: .72rem; font-weight: 650; gap: .28rem; padding: .22rem .55rem; white-space: nowrap; }
  .ghn-review-state::before { flex: 0 0 auto; font-size: .75em; }
  .ghn-review-state[data-state="ready"]::before,
  .ghn-review-state[data-state="ci-passed"]::before,
  .ghn-review-state[data-state="approved"]::before { content: "✓"; }
  .ghn-review-state[data-state="failed"]::before { content: "✕"; }
  .ghn-review-state[data-state="conflict"]::before { content: "⚡"; font-size: .8em; }
  .ghn-review-state[data-state="changes-requested"]::before { content: "✕"; }
  .ghn-review-state[data-state="comment"]::before { content: "◎"; }
  .ghn-review-state[data-state="queued"]::before { content: "↑"; }
  .ghn-tracked-header { align-items: center; display: flex; justify-content: space-between; margin-bottom: .6rem; }
  .ghn-tracked-header .ghn-field-title { margin: 0; }
  .ghn-link-button { background: transparent !important; border: none !important; color: var(--primary) !important; font-size: .8rem !important; font-weight: 600 !important; min-height: auto !important; padding: 0 !important; }
  .ghn-link-button:hover:enabled { text-decoration: underline; }
  .ghn-pull-labels { display: flex; flex-wrap: wrap; gap: .25rem; margin-top: .2rem; }
  .ghn-pull-label { background: rgb(255 255 255 / 8%); border: 1px solid rgb(255 255 255 / 12%); border-radius: .3rem; color: var(--muted-foreground); font-size: .65rem; font-weight: 600; padding: .05rem .35rem; }
  .ghn-pill-filter-bar { display: flex; flex-wrap: wrap; gap: .4rem; padding-bottom: .25rem; }
  button.ghn-filter-pill { align-items: center; background: rgb(255 255 255 / 5%); border: 1px solid rgb(255 255 255 / 13%); border-radius: 999px; color: var(--muted-foreground); cursor: pointer; display: inline-flex; font-size: .72rem; font-weight: 650; gap: .3rem; min-height: auto; padding: .22rem .6rem; white-space: nowrap; }
  button.ghn-filter-pill:hover { background: rgb(255 255 255 / 9%); color: var(--foreground); }
  button.ghn-filter-pill[aria-pressed="true"] { background: rgb(255 255 255 / 8%); border-color: rgb(255 255 255 / 30%); color: var(--foreground); }
  .ghn-pill-dot { border-radius: 50%; display: inline-block; flex: 0 0 .4rem; height: .4rem; width: .4rem; }
  .ghn-pill-dot[data-state="conflict"],
  .ghn-pill-dot[data-state="failed"],
  .ghn-pill-dot[data-state="changes-requested"] { background: #ff7777; }
  .ghn-pill-dot[data-state="queued"],
  .ghn-pill-dot[data-state="comment"] { background: #fbbf24; }
  .ghn-pill-dot[data-state="ci-passed"],
  .ghn-pill-dot[data-state="approved"],
  .ghn-pill-dot[data-state="ready"] { background: #5ee58c; }
  .ghn-pill-count { background: rgb(255 255 255 / 10%); border-radius: 999px; font-size: .65rem; font-weight: 700; padding: .05rem .35rem; }
  button.ghn-filter-pill[aria-pressed="true"][data-state="conflict"],
  button.ghn-filter-pill[aria-pressed="true"][data-state="failed"],
  button.ghn-filter-pill[aria-pressed="true"][data-state="changes-requested"] { background: rgb(239 68 68 / 15%); border-color: rgb(239 68 68 / 45%); color: #ff7777; }
  button.ghn-filter-pill[aria-pressed="true"][data-state="queued"],
  button.ghn-filter-pill[aria-pressed="true"][data-state="comment"] { background: rgb(245 158 11 / 15%); border-color: rgb(245 158 11 / 45%); color: #fbbf24; }
  button.ghn-filter-pill[aria-pressed="true"][data-state="ready"],
  button.ghn-filter-pill[aria-pressed="true"][data-state="ci-passed"],
  button.ghn-filter-pill[aria-pressed="true"][data-state="approved"] { background: rgb(34 197 94 / 12%); border-color: rgb(34 197 94 / 40%); color: #5ee58c; }
  .ghn-review-state[data-state="ready"],
  .ghn-review-state[data-state="ci-passed"],
  .ghn-review-state[data-state="approved"] { background: rgb(34 197 94 / 12%); border-color: rgb(34 197 94 / 32%); color: #5ee58c; }
  .ghn-review-state[data-state="failed"] { background: rgb(239 68 68 / 12%); border-color: rgb(239 68 68 / 36%); color: #ff7777; }
  .ghn-review-state[data-state="conflict"] { background: rgb(239 68 68 / 12%); border-color: rgb(239 68 68 / 36%); color: #ff7777; }
  .ghn-review-state[data-state="changes-requested"] { background: rgb(239 68 68 / 12%); border-color: rgb(239 68 68 / 36%); color: #ff7777; }
  .ghn-review-state[data-state="queued"],
  .ghn-review-state[data-state="comment"],
  .ghn-review-state[data-state="warning"] { background: rgb(245 158 11 / 12%); border-color: rgb(245 158 11 / 36%); color: #fbbf24; }
  .ghn-pull-actions { align-items: center; display: flex; gap: .6rem; justify-content: flex-end; }
  .ghn button.ghn-pr-link { align-items: center; aspect-ratio: 1; background: #242938; border: 1px solid rgb(255 255 255 / 11%); border-radius: .5rem; color: #d9dce8; display: inline-grid; flex: 0 0 2.25rem; font-size: 1.05rem; height: 2.25rem; justify-content: center; line-height: 1; min-height: 2.25rem; padding: 0; width: 2.25rem; }
  .ghn button.ghn-pr-link:hover { background: #303647; border-color: rgb(255 255 255 / 20%); color: white; }
  .ghn-pull-meta { color: var(--muted-foreground, #71717a); font-size: .75rem; }
  .ghn-tag[data-relation="author"] { background: rgb(102 87 255 / 12%); border-color: rgb(129 113 255 / 35%); color: #b29dff; }
  .ghn-tag[data-relation="review-requested"] { border-color: var(--warning, #f59e0b); color: var(--warning, #f59e0b); }
  .ghn-access-choices { display: flex; flex-direction: column; gap: .5rem; }
  .ghn-access-option {
    background: var(--surface-level-1, var(--card, #fff));
    border: 1px solid var(--surface-level-1-border, var(--border, #e4e4e7));
    border-radius: .75rem;
    display: flex;
    flex-direction: column;
    gap: .35rem;
    padding: .75rem .875rem;
  }
  .ghn-access-option p { margin: 0; }
  .ghn-access-title { font-weight: 600; }
  .ghn-access-subtitle { font-size: .875rem; font-weight: 600; }
  .ghn-steps { color: var(--muted-foreground, #71717a); display: flex; flex-direction: column; gap: .4rem; margin: 0; padding-left: 1.25rem; }
  .ghn-steps ul { margin: .2rem 0; padding-left: 1rem; }
  .ghn-steps strong { color: var(--foreground, #171717); }
  .ghn code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: .75rem; }
  .ghn-link { display: block; margin-top: .15rem; overflow-wrap: anywhere; user-select: all; }
  .ghn-visually-hidden {
    border: 0; clip: rect(0 0 0 0); height: 1px; margin: -1px; overflow: hidden;
    padding: 0; position: absolute; white-space: nowrap; width: 1px;
  }
  .ghn-section-toolbar { align-items: center; display: flex; gap: .75rem; margin-left: auto; }
  .ghn-section-toolbar input, .ghn-section-toolbar select { background: var(--input-background); border: 1px solid var(--border); border-radius: .6rem; color: inherit; font: inherit; min-height: 2.75rem; padding: .55rem .8rem; }
  .ghn-section-toolbar input { width: min(22rem, 30vw); }
  .ghn-status:empty, .ghn-error[hidden] { display: none; }
  #ghn-status { display: none; }
  #ghn-error:not([hidden]) { background: var(--card); border: 1px solid var(--border); border-radius: .65rem; padding: .7rem .9rem; }
  @media (max-width: 850px) {
    .ghn-header { right: 1rem; top: 1rem; }
    .ghn-body { padding: .75rem; }
    .ghn-section { border-radius: 1rem; padding: 1rem; }
    .ghn-section-toolbar { display: none; }
    .ghn-tracking-columns { grid-template-columns: 1fr; }
    .ghn-pull { grid-template-columns: 1fr auto; gap: .4rem .75rem; }
    .ghn-pull-main { grid-column: 1 / -1; }
    .ghn-pull-relations { justify-content: flex-start; }
    .ghn-pull-actions { grid-column: 2; grid-row: 1; }
  }
`;

export const prRadarTemplateBody = (): string => `
  <style>${styles}</style>
  <div
    class="ghn"
    data-component="PrRadarMiniApp"
    data-testid="pr-radar-shell"
  >
    <header class="ghn-header">
      <div class="ghn-title">
        <h1 class="ghn-heading">PR Radar</h1>
      </div>
      <div class="ghn-header-end">
        <div class="ghn-title" id="ghn-actions" hidden data-testid="pr-radar-actions">
          <button id="ghn-refresh" type="button" data-testid="pr-radar-refresh">Refresh</button>
          <button id="ghn-mark-read" type="button" hidden data-testid="pr-radar-mark-read">Mark all read</button>
        </div>
        <button
          id="ghn-access-btn"
          type="button"
          class="ghn-access-btn"
          aria-expanded="false"
          aria-controls="ghn-access-modal"
          data-testid="pr-radar-access-btn"
        >Connect GitHub</button>

        <div
          id="ghn-access-modal"
          class="ghn-access-modal"
          hidden
          role="dialog"
          aria-modal="true"
          aria-labelledby="ghn-modal-heading"
          data-testid="pr-radar-access"
        >
          <div class="ghn-modal-header">
            <h2 id="ghn-modal-heading" class="ghn-heading">GitHub access</h2>
            <button type="button" id="ghn-modal-close" class="ghn-modal-close" aria-label="Close">✕</button>
          </div>
          <p id="ghn-access-summary" class="ghn-status" data-testid="pr-radar-access-summary"></p>
          <p id="ghn-modal-error" class="ghn-error" role="alert" hidden data-testid="pr-radar-modal-error"></p>

          <div id="ghn-access-choices" class="ghn-access-choices" data-testid="pr-radar-access-choices">
            <div id="ghn-token-option" class="ghn-access-option" hidden data-testid="pr-radar-token-option">
              <p class="ghn-access-title">Use a GitHub personal access token</p>
              <p class="ghn-status">A separate read-only token lets PR Radar read pull requests and nothing else.</p>
              <p class="ghn-access-subtitle">How to create the token</p>
              <ol class="ghn-steps" data-testid="pr-radar-token-steps">
                <li>Open GitHub fine-grained token settings:
                  <code class="ghn-link" data-testid="pr-radar-token-url">https://github.com/settings/personal-access-tokens/new</code>
                </li>
                <li><strong>Resource owner:</strong> your account, or the organization that owns the repositories (the organization may need to approve the token).</li>
                <li><strong>Repository access:</strong> only the repositories you want to track.</li>
                <li><strong>Repository permissions:</strong>
                  <ul>
                    <li><code>Pull requests</code> — Read-only</li>
                    <li><code>Checks</code> — Read-only</li>
                    <li><code>Metadata</code> — Read-only (added automatically)</li>
                  </ul>
                  Leave every other permission as <em>No access</em>. No account permissions are needed.
                </li>
                <li>Generate the token and copy it.</li>
                <li>In TAP, open Settings → Connections → Credentials, add a credential of type <strong>HTTP Bearer Token</strong>, and paste the token.</li>
                <li>Click <strong>Reload</strong> below and choose the token.</li>
              </ol>
              <p class="ghn-status">Classic tokens are not recommended: reading private repositories needs the full <code>repo</code> scope, which also allows writing. <code>read:org</code> is not needed.</p>
              <div class="ghn-form">
                <label class="ghn-visually-hidden" for="ghn-credential-select">Saved token</label>
                <select id="ghn-credential-select" data-testid="pr-radar-credential-select"></select>
                <button type="button" id="ghn-use-credential" data-testid="pr-radar-use-credential">Use token</button>
                <button type="button" id="ghn-reload-credentials" data-testid="pr-radar-reload-credentials">Reload</button>
              </div>
            </div>

            <div class="ghn-access-option">
              <p class="ghn-access-title">Use TAP's GitHub connection</p>
              <p class="ghn-status">Uses the GitHub account connected to TAP. That token is shared with the rest of TAP and may allow writes to your repositories; PR Radar only sends read requests with it.</p>
              <p class="ghn-status"><strong>Before you allow:</strong> connect your GitHub account in TAP Settings → Connections → Personal integrations → GitHub. Allowing checks that connection first.</p>
              <div class="ghn-form">
                <button type="button" id="ghn-use-tap" data-testid="pr-radar-use-tap">Allow TAP's GitHub connection</button>
              </div>
            </div>
          </div>

          <div id="ghn-revoke-form" class="ghn-form" hidden>
            <button type="button" id="ghn-revoke-access" data-testid="pr-radar-revoke-access">Revoke access</button>
          </div>
        </div>
      </div>
    </header>

    <div class="ghn-body">
      <p id="ghn-status" class="ghn-status" role="status" data-testid="pr-radar-status"></p>
      <p id="ghn-error" class="ghn-error" role="alert" hidden data-testid="pr-radar-error"></p>

      <section id="ghn-tracking" class="ghn-section" aria-labelledby="ghn-setup-heading" hidden data-testid="pr-radar-tracking">
        <div class="ghn-section-heading">
          <span class="ghn-section-icon" aria-hidden="true">⚙</span>
          <div class="ghn-section-copy">
            <h2 id="ghn-setup-heading">Tracking</h2>
            <p>Choose which repositories and pull request events you want to track.</p>
          </div>
        </div>
        <div class="ghn-tracking-columns">
          <div class="ghn-tracking-left">
            <div>
              <p class="ghn-field-title">Add repository</p>
              <p class="ghn-field-help">Enter in the format owner/repository.</p>
              <form class="ghn-form ghn-repository-form" id="ghn-repository-form">
                <label class="ghn-visually-hidden" for="ghn-repository-input">Repository</label>
                <input id="ghn-repository-input" name="repository" type="text" autocomplete="off" spellcheck="false" placeholder="owner/repository" data-testid="pr-radar-repository-input" />
                <button class="ghn-primary-button" type="submit" id="ghn-add-repository" data-testid="pr-radar-add-repository">Add</button>
                <button class="ghn-browse-button" type="button" id="ghn-browse" data-testid="pr-radar-browse"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true" style="flex:0 0 auto"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg> &nbsp; Choose from my repositories</button>
              </form>
            </div>
            <div id="ghn-picker" class="ghn-picker" hidden data-testid="pr-radar-picker">
              <div class="ghn-form">
                <label class="ghn-visually-hidden" for="ghn-picker-filter">Filter repositories</label>
                <input id="ghn-picker-filter" type="search" autocomplete="off" spellcheck="false" placeholder="Filter repositories" data-testid="pr-radar-picker-filter" />
                <button type="button" id="ghn-picker-done" data-testid="pr-radar-picker-done">Done</button>
              </div>
              <p id="ghn-picker-count" class="ghn-status" data-testid="pr-radar-picker-count"></p>
              <ul id="ghn-suggestions" class="ghn-picker-list" data-testid="pr-radar-suggestions"></ul>
            </div>
          </div>
          <div class="ghn-tracking-right">
            <div class="ghn-tracked-header">
              <p class="ghn-field-title">Tracked repositories <span id="ghn-tracked-count" class="ghn-count"></span></p>
              <button type="button" id="ghn-clear-all" class="ghn-link-button" hidden data-testid="pr-radar-clear-all">Clear all</button>
            </div>
            <ul id="ghn-repositories" class="ghn-list" data-testid="pr-radar-repositories"></ul>
          </div>
        </div>
        <div class="ghn-form ghn-poll-form">
          <label for="ghn-poll-interval">Check GitHub every</label>
          <select id="ghn-poll-interval" data-testid="pr-radar-poll-interval"></select>
        </div>
      </section>

      <section id="ghn-pulls" class="ghn-section" aria-labelledby="ghn-pulls-heading" hidden data-testid="pr-radar-pulls">
        <div class="ghn-section-heading">
          <span class="ghn-section-icon" aria-hidden="true">⑂</span>
          <div class="ghn-section-copy">
            <h2 id="ghn-pulls-heading">Pull Requests <span id="ghn-pulls-count" class="ghn-count"></span></h2>
            <p>Pull requests involving you in tracked repositories.</p>
          </div>
          <div class="ghn-section-toolbar">
            <label class="ghn-visually-hidden" for="ghn-pull-search">Search pull requests</label>
            <input id="ghn-pull-search" type="search" placeholder="⌕  Search pull requests…" />
            <label class="ghn-visually-hidden" for="ghn-pull-repository">Filter by repository</label>
            <select id="ghn-pull-repository"><option value="">All repositories</option></select>
          </div>
        </div>
        <div id="ghn-pill-filter-bar" class="ghn-pill-filter-bar" hidden aria-label="Filter by status"></div>
        <div id="ghn-pulls-list" class="ghn-pulls" data-testid="pr-radar-pulls-list"></div>
        <p id="ghn-pulls-empty" class="ghn-empty" data-testid="pr-radar-pulls-empty">No open pull requests.</p>
      </section>

    </div>
  </div>
`;

/** Render the PR Radar surface and return its root element. */
export function renderPrRadarTemplate(container: HTMLElement): HTMLElement {
  const template = container.ownerDocument.createElement("template");
  template.innerHTML = prRadarTemplateBody();
  container.replaceChildren(template.content.cloneNode(true));
  const root = container.querySelector<HTMLElement>(".ghn");
  if (!root) throw new Error("PR Radar could not render its surface.");
  return root;
}
