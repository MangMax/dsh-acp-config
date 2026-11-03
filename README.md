# dsh-acp-config

A settings page for **`dsh --profile acp`** (DSH's Agent Client Protocol mode), rendered in the DSH Web UI you are already using.

ACP is a separate profile: it has no window of its own, and the Web UI's plugin switches, agent preset, and permission settings never reach it. This plugin closes that gap with three controls in one page:

| Control                | What it writes                                                     | Effect in ACP                                                           |
| ---------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Plugins**            | `- id: <row>` / `disabled: true \| false` in the ACP profile patch | Per-plugin **inherit the Web side's switch**, or force on / force off   |
| **Agent mode**         | `agent-preset-registry.config.default`                             | The preset every new ACP session runs (when no `--agentmode` is passed) |
| **Sandbox permission** | `sandbox-policy.config.mode` + `approval.config.policy`            | `read-only` / `workspace-write` / `danger-full-access`                  |

The page lives in **this** profile's settings (the one serving the Web UI); the writes go to **the ACP profile's** own patch layer. Nothing is installed into, started in, or restarted inside ACP.

## How it applies

Saving writes a clearly delimited block into `$DSH_HOME/profiles/acp/cordis.patch.yml`:

```yaml
# >>> dsh-acp-config:managed (generated; edits inside this block are overwritten on save)
- id: agent-preset-registry
  config:
    default: standard
    selectedDefault: null
- id: sandbox-policy
  config:
    mode: workspace-write
    workspaceRoot: !!js process.cwd()
- id: approval
  config:
    policy: ask
# <<< dsh-acp-config:managed
```

Everything outside the markers is preserved byte for byte. The ACP profile composes its patch layers at **startup** (`patchReload: startup`), so the change takes effect the **next time ACP starts**. The page states this and never claims a live change.

## Install

```bash
git clone https://github.com/MangMax/dsh-acp-config.git
cd dsh-acp-config && pnpm install && pnpm build
```

Then install the package directory into the profile that serves the Web UI:

- **Desktop app** (this GUI): Settings → Plugins → install from the absolute package directory, or ask the agent to install the bundle. The desktop profile is managed by the Electron app, so `dsh plugin --profile desktop …` is refused.
- **Web profile**: `dsh plugin --profile web add /absolute/path/to/dsh-acp-config`.

The package ships both halves: a Host row (`acp-config`) and a `dsh.client` bundle. After installation, **reload the page** (⌘R / Ctrl+R) and open Settings → **ACP 模式**.

## Requirements

- The ACP profile (`$DSH_HOME/profiles/acp`) must exist.
- **Agent mode** needs [`dsh-acp-agentmode`](https://github.com/MangMax/dsh-acp-agentmode) installed in the ACP profile, because that bundle inserts the `agent-preset-registry` row. Without it the control is disabled and the page says why.
- A plugin row can only be switched when it exists in **both** compositions. Plugins installed only in the Web profile are listed as _not in ACP_; install them into the ACP profile first (`dsh plugin --profile acp add <spec>`), then reload the page.

## What "inherit" means

`inherit` resolves at **save time**: the ACP row gets the Web side's current on/off state, and the page remembers the snapshot it used. If the Web side changes afterwards, the row shows a **drift** badge — save again to re-sync. This keeps the ACP patch file self-contained and inspectable; nothing is evaluated at ACP boot.

Rows owned by an agent preset (tools, skills, instructions, compaction, …) are **locked**: ACP moves that plane into presets per session, so a top-level override would register duplicates. Infrastructure rows ACP's own bundle layout owns (`hmr`, `settings`, `plugin-manager`, …) are locked too.

## Safety

- Only the managed block is ever rewritten; a missing/unbalanced marker pair aborts the write instead of guessing.
- Writes are atomic (temp file + rename), the first write leaves a `.bak`, file permissions are preserved, and an mtime/size conflict re-reads and retries once before failing.
- Profile names are validated and every write path must resolve inside the ACP profile directory.
- The ACP composition is read with `dsh --profile acp --dump-config` (async, 30 s timeout, killed on timeout); the page degrades to read-only warnings instead of failing when the dump is unavailable.

## Limitations

- **Startup-only**: ACP picks the change up on its next start.
- **Inherit is a snapshot** (see above), not a live link.
- Once the sandbox control is saved, `DSH_PERMISSION_MODE` no longer decides ACP's default mode; the page's value does.
- The page needs a browser reload after installation; DSH does not hot-load new client bundles in a released build.
- `selectedDefault: null` is written with the agent mode so this page wins over an earlier `--agentmode … --remember`; that is intentional and explained in the page's warnings.

## Files it touches

| Path                                          | What                                          |
| --------------------------------------------- | --------------------------------------------- |
| `$DSH_HOME/profiles/acp/cordis.patch.yml`     | managed block only                            |
| `$DSH_HOME/profiles/acp/.dsh-acp-config.json` | this page's saved choices + inherit snapshots |

Nothing else. No package installation, no profile `package.json` edits, no process management.

## Development

```bash
pnpm install
pnpm check      # vp check: format + oxlint (type-aware) + tsc
pnpm test       # vp test run
pnpm build      # vp pack: dist/index.mjs (Host), dist/client.iife.js (Client)
pnpm verify     # check + test + build
node scripts/acp-dump-check.mjs   # inspect the ACP composition this page can change
```

Design notes and the exact rules live in [`docs/DESIGN.md`](docs/DESIGN.md). The toolchain is **pnpm + Vite+** with zero runtime dependencies; React is supplied by DSH's browser module table and is never bundled.
