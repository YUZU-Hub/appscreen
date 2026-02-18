<!--
Sync Impact Report
===================
Version change: 0.0.0 (template) -> 1.0.0
Modified principles: N/A (initial adoption)
Added sections:
  - Principle I: Code Quality (new)
  - Principle II: Testing Standards (new)
  - Principle III: User Experience Consistency (new)
  - Principle IV: Performance Requirements (new)
  - Technology Stack & Constraints (new)
  - Development Workflow (new)
  - Governance (new)
Removed sections:
  - Template Principle V placeholder (user specified 4 principles)
Templates requiring updates:
  - .specify/templates/plan-template.md: ✅ no update needed (generic)
  - .specify/templates/spec-template.md: ✅ no update needed (generic)
  - .specify/templates/tasks-template.md: ✅ no update needed (generic)
  - .specify/templates/commands/*.md: ✅ no files exist
  - CLAUDE.md: ✅ no update needed (no constitution references)
Follow-up TODOs: none
-->

# App Store Screenshot Generator Constitution

## Core Principles

### I. Code Quality

All code MUST adhere to the following non-negotiable standards:

- **Single Responsibility**: Every function MUST serve one clear
  purpose. Functions exceeding 80 lines MUST be decomposed into
  smaller, well-named helpers.
- **Centralized State**: All application state MUST flow through the
  `state` object. Direct DOM-based state storage is prohibited.
  State mutations MUST trigger `updateCanvas()` to maintain
  render consistency.
- **Consistent Naming**: Functions MUST use `camelCase`. Event
  handlers MUST be prefixed with `handle` (e.g., `handleFiles`).
  Getter functions MUST be prefixed with `get` (e.g.,
  `getTextSettings`). Boolean variables MUST read as predicates
  (e.g., `isLoading`, `hasChanges`).
- **Error Handling**: All async operations (IndexedDB, file I/O,
  API calls) MUST include explicit error handling with user-facing
  feedback. Silent failures are prohibited.
- **No Global Pollution**: New global variables MUST NOT be
  introduced. Shared utilities MUST be scoped to their module file
  (`app.js`, `three-renderer.js`, `language-utils.js`).
- **Code Documentation**: Functions with non-obvious behavior MUST
  include a brief comment explaining intent. Canvas rendering
  pipeline stages MUST document their draw order dependencies.

**Rationale**: The project uses vanilla JavaScript without a type
system or build-time checks. Strict code conventions serve as the
primary defense against regressions in a ~6000-line codebase.

### II. Testing Standards

All changes MUST be validated before merge:

- **Manual Browser Testing**: Every UI change MUST be verified in
  the browser via the local development server
  (`python3 -m http.server 8000`). Filesystem-only testing is
  insufficient due to IndexedDB requirements.
- **Canvas Rendering Verification**: Changes to `drawBackground()`,
  `drawScreenshot()`, `drawText()`, or `drawNoise()` MUST be
  visually verified across at least three screenshot configurations:
  (1) gradient background with text, (2) image background with
  device mockup, (3) 3D device rendering.
- **Persistence Round-Trip**: Any modification to `saveState()` or
  `loadState()` MUST be tested by saving state, reloading the page,
  and confirming all settings restore correctly.
- **Export Validation**: Changes affecting `exportCurrent()` or
  `exportAll()` MUST produce correct PNG output. Batch exports
  MUST generate valid ZIP archives with all selected screenshots.
- **Multi-Language Coverage**: Text rendering changes MUST be tested
  with at least two languages (one LTR, one RTL or multi-byte) to
  verify layout integrity.
- **Cross-Browser Baseline**: Major feature additions MUST be
  verified in both Chromium-based browsers and Safari to catch
  Canvas API or IndexedDB compatibility issues.

**Rationale**: Without automated tests, the rendering pipeline and
persistence layer depend entirely on disciplined manual validation.
Each category above targets a historically fragile surface.

### III. User Experience Consistency

The user interface MUST maintain coherent behavior across all
interactions:

- **State-UI Synchronization**: Every state change MUST be
  reflected in the UI via `syncUIWithState()`. Controls MUST
  never display stale values after state transitions.
- **Canvas-as-Truth**: The main canvas MUST always represent the
  current state. `updateCanvas()` MUST be called after every
  state mutation that affects visual output.
- **Modal Patterns**: All modal dialogs (settings, project
  management, translations, duplicate detection, language
  selection) MUST follow the same open/close animation, backdrop
  behavior, and keyboard dismissal (Escape key) conventions.
- **Dark Theme Integrity**: New UI elements MUST use existing CSS
  custom properties and color values from `styles.css`. Ad-hoc
  color literals are prohibited in new code.
- **Layout Stability**: The 3-column CSS Grid layout (left sidebar,
  canvas, right sidebar) MUST remain stable during all
  interactions. Sidebar controls MUST NOT cause layout shifts in
  the canvas area.
- **Carousel Continuity**: Screenshot navigation via the side
  preview carousel MUST use `slideToScreenshot()` for smooth
  transitions. Abrupt jumps without animation are prohibited
  except during initial page load.
- **Localization Parity**: All text-bearing UI components MUST
  render correctly for every supported language. The fallback
  chain in `getScreenshotImage()` MUST be respected so no
  screenshot displays a broken or missing image state.

**Rationale**: This is a visual design tool where inconsistent UI
behavior directly undermines user trust and creative workflow.
Strict synchronization and pattern adherence prevent the subtle
desynchronization bugs common in canvas-based applications.

### IV. Performance Requirements

The application MUST meet these performance thresholds:

- **Canvas Render Time**: A single `updateCanvas()` call MUST
  complete in under 100ms for standard 2D screenshots. Users MUST
  NOT perceive lag when adjusting sliders or toggles.
- **3D Render Budget**: Three.js rendering via
  `renderThreeJSToCanvas()` MUST complete within 500ms for a
  single frame at export resolution. Interactive drag-to-rotate
  on the preview canvas MUST maintain at least 30fps.
- **Image Upload Responsiveness**: `handleFiles()` MUST NOT block
  the UI thread for more than 200ms per image. Large images MUST
  be processed asynchronously with a visible loading indicator.
- **IndexedDB Non-Blocking**: All IndexedDB operations
  (`saveState`, `loadState`, project CRUD) MUST be fully
  asynchronous. The UI MUST remain interactive during persistence
  operations.
- **Export Scalability**: `exportAll()` MUST handle projects with
  up to 20 screenshots without exceeding 500MB memory usage.
  ZIP generation via JSZip MUST stream or chunk data to avoid
  memory spikes.
- **Font Loading**: Google Fonts MUST load asynchronously and MUST
  NOT block initial page render or canvas interactions. Fallback
  fonts MUST be displayed until the requested font is available.
- **Asset Loading**: The 3D iPhone model (`iphone-15-pro-max.glb`)
  MUST load asynchronously with a progress indicator. Failure to
  load MUST gracefully fall back to 2D mode without errors.

**Rationale**: As a client-side creative tool, perceived
responsiveness is critical to the editing experience. These
thresholds are calibrated to the project's specific rendering
pipeline and data persistence architecture.

## Technology Stack & Constraints

- **Runtime**: Browser-based, no server-side processing. All logic
  executes client-side in vanilla JavaScript (ES6+).
- **Rendering**: HTML5 Canvas (2D context) for screenshot
  composition. Three.js r128 with GLTFLoader for 3D device mockups.
- **Persistence**: IndexedDB with two object stores (`projects`
  for data, `meta` for project list). No localStorage fallback.
- **Styling**: Single `styles.css` file using CSS Grid layout and
  a dark theme. No CSS preprocessors or frameworks.
- **Dependencies**: Three.js (r128), GLTFLoader, JSZip, Google
  Fonts API. All loaded via CDN. No npm, no bundler, no build
  step.
- **File Structure**: Three main JavaScript files (`app.js`,
  `three-renderer.js`, `language-utils.js`) plus `index.html`
  and `styles.css`. New JavaScript files MUST NOT be introduced
  without constitution amendment.
- **Browser Support**: Chromium-based browsers and Safari. Features
  MUST NOT rely on APIs unavailable in current Safari releases.

## Development Workflow

- **Local Server Required**: Development MUST use a local HTTP
  server (`python3 -m http.server 8000` or `npx serve .`).
  Opening `index.html` directly from the filesystem is prohibited
  as it breaks IndexedDB persistence.
- **Change Verification**: Every change MUST be visually verified
  in the browser before being considered complete. The canvas
  rendering pipeline (`drawBackground` -> `drawScreenshot` ->
  `drawText` -> `drawNoise`) MUST be tested end-to-end for any
  rendering-related modification.
- **Commit Discipline**: Commits MUST follow conventional commit
  format. Each commit MUST represent a single logical change.
  Commit messages MUST be approved before execution per the
  project's agent instructions.
- **No Build Artifacts**: The project has no build process. All
  code MUST be directly executable in the browser without
  transpilation, bundling, or compilation.

## Governance

This constitution is the authoritative reference for all
development decisions in the App Store Screenshot Generator
project. It supersedes informal conventions and ad-hoc practices.

- **Compliance**: All code changes MUST be verified against the
  applicable principles before merge. Reviewers MUST cite the
  specific principle when requesting changes for compliance
  reasons.
- **Amendment Process**: Amendments require documentation of the
  proposed change, rationale, and impact assessment. Amendments
  MUST update the version number according to semantic versioning:
  - MAJOR: Principle removal or incompatible redefinition
  - MINOR: New principle or material expansion of existing guidance
  - PATCH: Wording clarification, typo fix, non-semantic refinement
- **Complexity Justification**: Any deviation from these principles
  MUST be explicitly justified with a documented rationale. The
  justification MUST explain why the simpler, compliant
  alternative is insufficient.
- **Review Cadence**: Principles SHOULD be reviewed quarterly to
  ensure they remain aligned with the project's evolution. Review
  findings MUST be recorded as constitution amendments or
  explicit reaffirmations.
- **Runtime Guidance**: See `CLAUDE.md` for agent-specific
  development guidance and operational instructions.

**Version**: 1.0.0 | **Ratified**: 2026-02-18 | **Last Amended**: 2026-02-18
