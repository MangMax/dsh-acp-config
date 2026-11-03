// Stylesheet for the "ACP mode" settings page.
//
// The page renders this once (a single `<style>` element) instead of shipping a
// CSS file, because a dynamic Client half only gets its JS loaded. Every class
// is prefixed `dac-`, and every surface/text colour comes from a
// `--dsw-alias-*` theme token so the page follows DSH's light/dark themes; the
// only literal colour is the neutral toast shadow (rgba, not a hue).
//
// Card geometry follows docs/OFFICIAL-UI-SPEC.md, measured from the shipped
// plugins page: 20px radius on a layer-2 surface, 12/14 content padding, 14/500
// title, 12/18 description, 999px tag, 12px chevron, and a layer-3 details
// drawer separated by a border-top.
//
// Structural rules worth keeping:
// - Badge text is always the neutral secondary label colour; the *state* lives
//   only in the `.dac-dot`, so a badge never fails contrast on any theme.
// - The action bar is a sticky last child of the page flow (`bottom:0`), which
//   needs the page to stay free of `overflow:hidden`; nothing here clips the
//   scroll container the settings shell provides.
// - The page scrolls as ONE region: no list carries a `max-height`, so the
//   settings shell (not a nested box) owns scrolling.
// - Tabs are marked by a bottom underline, never a side rule.
// - Toasts are `position:fixed` above the dock (`--dac-dock-h`) at a higher
//   z-index, so a notification never covers the save button. Tone is carried by
//   the title colour plus a dot only — no coloured side rules anywhere.

export const STYLES = `
.dac-page{--dac-dock-h:56px;display:flex;flex-direction:column;gap:14px;width:100%;max-width:820px;box-sizing:border-box}
.dac-head{display:flex;flex-direction:column;gap:4px;padding:0 2px}
.dac-title{margin:0;color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:22px}
.dac-sub{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.dac-body{display:flex;flex-direction:column;gap:14px;min-width:0}
.dac-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2);padding:0 2px;overflow-x:auto;scrollbar-width:none}
.dac-tab{position:relative;display:inline-flex;align-items:center;gap:6px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:20px;padding:8px 10px 10px;cursor:pointer;white-space:nowrap;border-radius:6px 6px 0 0;transition:color .12s ease}
.dac-tab:hover{color:var(--dsw-alias-label-primary)}
.dac-tab[aria-selected="true"]{color:var(--dsw-alias-label-primary)}
.dac-tab::after{content:'';position:absolute;left:8px;right:8px;bottom:0;height:2px;border-radius:2px;background:transparent;transition:background .12s ease}
.dac-tab[aria-selected="true"]::after{background:var(--dsw-alias-brand-primary)}
.dac-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dac-tab-badge{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:0 6px;font-size:11px;line-height:16px;font-weight:400;font-variant-numeric:tabular-nums}
.dac-tab-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary);flex:none}
.dac-panel{display:flex;flex-direction:column;gap:14px;min-width:0}

/* Official card shell and folded face (docs/OFFICIAL-UI-SPEC.md). */
.dac-card{position:relative;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:20px;overflow:hidden;box-sizing:border-box}
.dac-card-body{padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.dac-cards{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin:0;padding:0;list-style:none}
.dac-cards:empty{display:none}
.dac-card-head{display:flex;align-items:center;gap:10px;padding-right:12px}
.dac-card-head .dac-card-content{flex:1;min-width:0}
.dac-card-aside{flex:none;display:inline-flex;align-items:center;gap:8px}
.dac-card-content{display:flex;flex-direction:column;gap:2px;width:100%;padding:12px 14px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dac-card-content:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dac-card-row{display:flex;gap:12px;align-items:center;justify-content:space-between;min-width:0}
.dac-card-title{min-width:0;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dac-card-trailing{flex:none;display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary)}
.dac-tag{display:inline-flex;align-items:center;border-radius:999px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-tertiary);padding:1px 8px;font-size:11px;font-weight:500;line-height:17px;white-space:nowrap}
.dac-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease}
.dac-chevron-open{transform:rotate(180deg)}
.dac-card-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dac-card-risk{color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px;padding-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.dac-card-meta{padding-top:6px;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dac-card-select .dac-card-content{padding-right:46px}
.dac-card-toggle{position:absolute;top:11px;right:10px;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dac-card-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dac-card-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dac-card-on{border-color:var(--dsw-alias-brand-primary)}

/* Details drawer: layer-3 surface, top border, 10/14/12 padding. */
.dac-card-details{display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-3);border-top:1px solid var(--dsw-alias-border-l2);padding:10px 14px 12px}
.dac-entry{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.dac-card-dl{margin:0;display:flex;flex-direction:column;gap:4px}
.dac-card-dl-row{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:14px;font-size:12px;line-height:18px}
.dac-card-dl-row dt{color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.dac-card-dl-row dd{margin:0;color:var(--dsw-alias-label-secondary);min-width:0;overflow-wrap:anywhere}
.dac-card-controls{display:flex;flex-direction:column;gap:6px;padding-top:2px}
.dac-card-control-label{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.dac-card-hint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}

/* Folded groups: header row + description + card list. */
.dac-groups{display:flex;flex-direction:column;gap:16px}
.dac-group{display:flex;flex-direction:column;gap:6px}
.dac-group-head{display:flex;gap:8px;align-items:center;width:100%;padding:6px 4px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:600;line-height:20px;text-align:left;cursor:pointer}
.dac-group-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dac-group-head:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dac-group-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dac-group-trailing{flex:none;display:inline-flex;align-items:center;gap:6px}
.dac-group-desc{margin:0;padding:0 4px 2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}

.dac-kv{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 14px;font-size:13px;line-height:20px}
.dac-kv-key{color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dac-kv-val{color:var(--dsw-alias-label-primary);min-width:0;overflow-wrap:anywhere}
.dac-mono{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:18px;overflow-wrap:anywhere;word-break:break-word}
.dac-warnlist{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:2px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dac-section{display:flex;flex-direction:column;gap:10px}
.dac-section-head{display:flex;flex-direction:column;gap:4px;padding:0 2px}
.dac-section-title{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}
.dac-section-desc{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dac-search-row{display:flex;gap:8px;align-items:center}
.dac-search{box-sizing:border-box;flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 10px;font:inherit;font-size:13px;line-height:20px}
.dac-search::placeholder{color:var(--dsw-alias-label-caption)}
.dac-search:hover{border-color:var(--dsw-alias-border-l1)}
.dac-search:focus,.dac-search:focus-visible{outline:none;border-color:var(--dsw-alias-brand-primary)}
.dac-count{flex:none;color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.dac-badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);border-radius:6px;padding:0 7px;font-size:12px;line-height:18px;white-space:nowrap}
.dac-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-secondary);flex:none}
.dac-badge-warn .dac-dot{background:var(--dsw-alias-state-warn-primary)}
.dac-card-aside .dac-seg{flex:none;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-3)}
.dac-card-aside .dac-seg-btn{padding:2px 8px;font-size:12px;line-height:18px;border-radius:6px}
.dac-seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);border-radius:8px;padding:2px;gap:2px}
.dac-seg-btn{border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;padding:3px 10px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:normal;text-align:center;transition:background .12s ease,color .12s ease}
.dac-seg-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dac-seg-btn[aria-checked="true"]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}
.dac-seg-btn:disabled{opacity:.45;cursor:default}
.dac-seg-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dac-note{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dac-note-warn{color:var(--dsw-alias-state-warn-primary)}
.dac-error-detail{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dac-state{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:18px;display:flex;flex-direction:column;gap:8px;align-items:flex-start;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dac-empty{border:1px dashed var(--dsw-alias-border-l1);border-radius:10px;padding:14px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dac-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-top:2px}
.dac-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 14px;font:inherit;font-size:13px;line-height:20px;cursor:pointer;flex:none;transition:background .12s ease,border-color .12s ease}
.dac-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dac-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dac-btn:disabled{opacity:.5;cursor:default}
.dac-btn-primary{border-color:var(--dsw-alias-button-info-fill);background:var(--dsw-alias-button-info-fill);color:var(--dsw-alias-label-primary-foreground);font-weight:600}
.dac-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-info-hover);border-color:var(--dsw-alias-button-info-hover)}
.dac-dirty{color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}
.dac-clean{color:var(--dsw-alias-label-caption);font-size:12px;line-height:18px}

.dac-dock{position:sticky;bottom:0;z-index:3;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-1);border-top:1px solid var(--dsw-alias-border-l2);padding:10px 0 6px;margin-top:4px}
.dac-toasts{position:fixed;right:24px;bottom:calc(24px + var(--dac-dock-h,56px));z-index:20;display:flex;flex-direction:column;gap:8px;width:320px;max-width:calc(100vw - 48px);pointer-events:none}
.dac-toast{pointer-events:auto;display:flex;gap:8px;align-items:flex-start;width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:10px 12px;font-size:13px;line-height:20px}
.dac-toast-dot{flex:none;width:6px;height:6px;margin-top:6px;border-radius:50%;background:var(--dsw-alias-label-secondary)}
.dac-toast-ok .dac-toast-dot{background:var(--dsw-alias-state-success-primary)}
.dac-toast-warn .dac-toast-dot{background:var(--dsw-alias-state-warn-primary)}
.dac-toast-error .dac-toast-dot{background:var(--dsw-alias-state-error-primary)}
.dac-toast-body{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.dac-toast-title{font-weight:600;color:var(--dsw-alias-label-primary)}
.dac-toast-ok .dac-toast-title{color:var(--dsw-alias-state-success-primary)}
.dac-toast-warn .dac-toast-title{color:var(--dsw-alias-state-warn-primary)}
.dac-toast-error .dac-toast-title{color:var(--dsw-alias-state-error-primary)}
.dac-toast-detail{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.dac-toast-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.dac-toast-actions .dac-btn{padding:3px 10px;font-size:12px;line-height:18px}
.dac-toast-close{flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:14px;line-height:18px;padding:0 2px;cursor:pointer;border-radius:4px}
.dac-toast-close:hover{color:var(--dsw-alias-label-primary)}
.dac-toast-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
@media (max-width:720px){
.dac-page{--dac-dock-h:96px}
.dac-kv{grid-template-columns:minmax(0,1fr);gap:0}
.dac-kv-key{white-space:normal;font-size:12px;line-height:18px;margin-top:8px}
.dac-kv-key:first-child{margin-top:0}
.dac-kv-val{font-size:13px;line-height:20px;overflow-wrap:anywhere;word-break:break-word}
.dac-seg{width:100%}
.dac-seg-btn{flex:1 1 auto}
.dac-tabs{padding:0}
.dac-card-dl-row{grid-template-columns:minmax(0,1fr);gap:0}
.dac-card-dl-row dt{margin-top:4px}
.dac-dock{padding-bottom:2px}
.dac-dock .dac-actions{row-gap:6px}
.dac-dock .dac-actions .dac-dirty,.dac-dock .dac-actions .dac-clean{flex-basis:100%}
.dac-toasts{left:12px;right:12px;width:auto;bottom:calc(16px + var(--dac-dock-h,96px))}
}
`
