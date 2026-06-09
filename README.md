# Bullarchy GUI

A graphical interface for the [Bullarchy](https://github.com/My-sidequests/Bullarchy) toolchain — the project manager and transpiler CLI for the [Bullang](https://github.com/My-sidequests/Bullang) language.

---

## How it works

Bullarchy GUI runs a small [axum](https://github.com/tokio-rs/axum) HTTP server on `localhost:7474` and opens the interface in your default browser. The frontend communicates with the server over `POST /api/<command>`. No internet connection is required beyond the initial font load.

---

## Installation

```bash
cargo install --git https://github.com/My-sidequests/Bullarchy-gui.git
```

Then launch it from any directory:

```bash
bullarchy-gui
```

The browser will open automatically. The server stays running until you close the terminal or press `Ctrl+C`.

---

## Interface

The home screen presents five cards arranged in two rows.

**Top row**

| Card | What it does |
|---|---|
| **init** | Scaffold a new Bullang project — depth-based or from a blueprint file |
| **convert** | Transpile a `.bu` project or single file to rs / py / c / cpp / go |
| **blueprint** | Design and save a `blueprint.bu` file in an interactive split-pane editor |

**Bottom row**

| Card | What it does |
|---|---|
| **control** | Expands into two sub-commands: **check** (validate + type-check + format drift) and **fmt** (reformat all `.bu` files, with optional dry-run) |
| **options** | Expands into two sub-commands: **editor-setup** (write LSP configs for Neovim, Vim, Helix, Emacs) and **update** (reinstall from the latest commit) |

### Blueprint editor

The blueprint panel is a split-pane editor modelled after Obsidian:

- **Left pane** — raw `blueprint.bu` textarea with live syntax validation. A `✓ valid` / `✗ error` indicator updates as you type.
- **Right pane** — live tree preview showing the project structure inferred from what you've written (folders, files, functions, goal strings).
- **Save bar** — type any absolute path and click **Save blueprint** to write the file to disk. Parent directories are created automatically.

---

## Architecture

```
bullarchy-gui/
├── src/
│   ├── main.rs            # axum server, embedded frontend, route registration
│   ├── routes.rs          # HTTP handlers — one per command + blueprint save
│   ├── cmd/               # command logic (mirrored from Bullarchy)
│   ├── build.rs           # transpiler pass
│   ├── codegen/           # 5 language backends
│   ├── init/              # project scaffolding + blueprint parser
│   ├── validator/         # structural + parse validation
│   └── ...                # shared modules
└── frontend/
    ├── index.html         # app shell
    ├── style.css          # cosmic dark theme (deep blue / nebula)
    └── app.js             # panel logic, blueprint editor, star field, API calls
```

The frontend is embedded into the binary at compile time via `include_str!` — no separate file serving is needed after installation.

### API endpoints

| Method | Path | Handler |
|---|---|---|
| `POST` | `/api/init` | `handle_init` |
| `POST` | `/api/convert` | `handle_convert` |
| `POST` | `/api/fmt` | `handle_fmt` |
| `POST` | `/api/check` | `handle_check` |
| `POST` | `/api/editor-setup` | `handle_editor_setup` |
| `POST` | `/api/update` | `handle_update` |
| `POST` | `/api/blueprint/save` | `handle_blueprint_save` |

---

## Relationship to Bullarchy (terminal)

Bullarchy GUI is a **separate repository** that mirrors the terminal version's command logic exactly. Both tools share the `bullang` library crate. The GUI captures stdout/stderr from each command via an OS-level pipe redirect and returns the output as JSON to the browser.

For the terminal version, see [Bullarchy](https://github.com/My-sidequests/Bullarchy).
