# Media manager for Garmin watches

Client-side web app that manages the music, podcasts, audiobooks and `.img` maps on a Garmin watch. It talks MTP over WebUSB through `libmtp-web` (libmtp compiled to WebAssembly). No backend: everything runs in the browser and deploys as a static site to GitHub Pages at https://garmin-manager.apps.stanis.me/.

## Commands

Bun lives in `~/opt/bun/bin`.

- `bun run dev`: hot-reloading dev server on `src/index.html`
- `bun run build`: bundle into `dist/` and copy `assets/`
- `bun test`: unit tests (`src/*.test.ts`)
- `bun run typecheck`: `tsc --noEmit`

Run typecheck and tests before finishing a change. CI (`.github/workflows/pages.yml`) runs both, then builds and deploys on push to `main`.

## Architecture

- `src/index.html`: page shell, CSP, footer. Bun bundles from here.
- `src/components/`: Preact components. State lives in `@preact/signals` in `src/state.ts`, not component state.
- `src/flows.ts`: user-facing operations (connect, scan, stage, upload, delete). Sets the status line.
- `src/device.ts`: the only module that drives `libmtp-web`. Folder discovery and uploads.
- `src/metadata.ts`: audio tags via jsmediatags over ranged device reads.
- `src/img.ts`, `src/map-info.ts`, `src/map-groups.ts`: Garmin `.img` header parsing and grouping.
- `src/staging.ts`: rules for accepting dropped files (type, title, duplicates).
- `src/style.css`: imports HiQ plus app overrides. No CSS framework beyond HiQ.

## Constraints

- Target Chrome 137+ only (WebUSB, WebAssembly JSPI). No polyfills or fallbacks for other browsers.
- Device reads are slow and transfers are large. Read only the bytes needed (ranged reads for headers and tags), never whole files for metadata.
- The watch groups audiobook chapters and podcast episodes by album **and** artist. Genre alone routes audio to Music, Podcasts or Audiobooks.
- The CSP in `src/index.html` allows only same-origin resources, `wasm-unsafe-eval`, and Trusted Types with no policies. Don't add inline scripts, inline `style` attributes in HTML, `innerHTML`, or third-party origins.
- Keep URLs relative so the build works from any path, including `fstanis.github.io/garmin-manager/`. `assets/manifest.webmanifest` uses `./` for `start_url` and `scope`.
- `patches/hiq@4.2.11.patch` removes `::-webkit-file-upload-button` rules that Bun's CSS parser rejects. Keep it until Bun accepts them or HiQ drops them.

# Code Style & Quality

## Code Style

- Follow standard casing conventions for the language (e.g., camelCase for variables/functions, PascalCase for classes).
- Prefix boolean variables with `is`, `has`, `can`, or `should`.
- Avoid optional or nullable types when the empty or default value is functionally identical.
- Always use braces `{}` for control flow blocks. The body must go on its own line inside the braces.
- Do not nest ternaries or use them for multi-way branching. Use conditional statements or a lookup map. A single inline ternary is acceptable.
- Write one statement per line.
- Avoid copy-pasting multi-line blocks. Extract shared logic into reusable components.

## Naming

- Use intention-revealing names. Avoid abbreviations and single letters, except for short loop counters.
- Ensure names are pronounceable and searchable.
- Name services and classes as nouns; name actions and methods as verbs.
- Use one word per concept across the codebase.
- Avoid noise words and context already implied by the enclosing module.

## Comments

- In general, DO NOT COMMENT CODE. If code requires explanation, extract it into a well-named variable or function.
- When necessary, limit inline comments to a single terse line explaining external constraints, surprising decisions preventing future bugs, or performance choices backed by metrics.
- Document exported functions, types, and constants using the language's standard documentation format (e.g. javadoc, jsdoc), stating only contract the declaration cannot express: units, ranges, defaults, side effects, failure modes, invariants, or external constraints. If the name and signature already convey the full contract, omit the comment entirely.
- Do not narrate obvious code.
- Do not leave commented-out code.
- Do not restate the signature in the documentation comment, and do not summarize information already visible in the referenced types.
- Do not explain language or API mechanics the reader is expected to know (e.g. that a method is async, or how to iterate, await, or cancel).
- Every sentence must add information; delete any sentence the reader could reconstruct from the code alone.

## Functions

- Keep functions small and at a single level of abstraction. Extract distinct operational sections into their own functions.
- Limit parameters. Group related arguments into a single options object. Avoid positional boolean flags.
- Ensure no side effects occur beyond what the function name implies.
- Keep related code vertically close and order functions caller-above-callee.

## Error Handling

- Throw specific, context-rich error types or classes rather than returning error codes.
- Never swallow errors silently.
- Validate inputs only at system boundaries. Do not re-validate downstream.
- Return an empty collection rather than a null state for "no results."
- Fail fast. Surface bad state at the point of detection.

## Design

- Adhere to the Single Responsibility Principle. A module or class should have one reason to change.
- Keep interfaces small and focused. Consumers should not depend on methods they never call.
- Depend on abstractions. Intercept other components through defined interfaces, not internal logic.
- Favor composition over inheritance.
- Keep components small and cohesive.

## Conditionals & Coupling

- Extract complex boolean expressions into well-named variables or functions.
- Prefer a lookup map or a switch statement over long conditional chains for behavior varying by type.
- Follow the Law of Demeter. Do not chain through objects to reach behavior; communicate only with immediate collaborators.

## Good Code Practices

- Never mutate input parameters or return values from other functions. Create new data structures when modifications are necessary.
- Collect necessary data early and fall through to shared code paths to prevent duplicated logic across multiple return statements.
- Use collections over conditionals for tracking. Track state via an append-only collection and evaluate it at the end to eliminate conditional branching.
- Do not create abstractions prematurely. Keep single-use, readable logic inline.
- Extend a shared utility's seam instead of hand-stripping or rewriting inputs before forwarding them. Pre-processing creates a parallel version of the utility's contract that drifts as the utility evolves.
