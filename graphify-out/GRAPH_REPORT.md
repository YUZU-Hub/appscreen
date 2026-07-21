# Graph Report - ScreenshotsGenerator  (2026-07-21)

## Corpus Check
- 23 files · ~117,765 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 421 nodes · 722 edges · 57 communities (26 shown, 31 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 9 edges (avg confidence: 0.63)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `66e5927f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- app.js
- updateCanvas
- build
- setupEventListeners
- package.json
- three-renderer.js
- language-utils.js
- speckit.analyze.md
- magical-titles.js
- renderScreenshotToCanvas
- SpecKit Analyze Command
- main.js
- speckit.specify.md
- Canvas Rendering Pipeline Architecture
- llm.js
- dependencies
- translateAllText
- Graphify Query Rule
- Main App HTML Shell
- CLAUDE.md
- Docker Compose AppScreen Service
- App Store Screenshot Generator
- preload.js
- preload-preferences.js
- App Showcase Screenshot Image
- createNewScreenshot
- getText
- GitHub Funding Configuration
- Build and Publish Docker Image Workflow
- Build Electron App Workflow
- Electron Preferences Window
- Application Favicon Asset
- speckit.plan.md
- Task Generation Rules
- getScreenshotSettings
- renderFontList
- speckit.checklist.md
- exportAll
- speckit.clarify.md
- speckit.constitution.md
- speckit.implement.md
- speckit.taskstoissues.md
- graphify.md
- graphify.md
- Graphify Codebase Rule
- Graphify Workflow
- SpecKit Checklist Command
- SpecKit Clarify Command
- SpecKit Constitution Command
- SpecKit Implement Command
- SpecKit Plan Command
- SpecKit Specify Command
- SpecKit Tasks Command
- SpecKit Tasks to Issues Command
- 3D iPhone Rendering Architecture
- AI Provider Selection UI
- App Store Screenshot Generator Documentation

## God Nodes (most connected - your core abstractions)
1. `setupEventListeners()` - 43 edges
2. `updateCanvas()` - 40 edges
3. `syncUIWithState()` - 27 edges
4. `saveState()` - 18 edges
5. `getTextSettings()` - 17 edges
6. `updateScreenshotList()` - 17 edges
7. `getCurrentScreenshot()` - 13 edges
8. `switchProject()` - 13 edges
9. `updateGradientStopsUI()` - 13 edges
10. `getScreenshotSettings()` - 11 edges

## Surprising Connections (you probably didn't know these)
- `setupEventListeners()` --indirect_call--> `closeScreenshotTranslationsModal()`  [INFERRED]
  app.js → language-utils.js
- `setupEventListeners()` --indirect_call--> `handleTranslationFileSelect()`  [INFERRED]
  app.js → language-utils.js
- `setupEventListeners()` --indirect_call--> `generateMagicalTitles()`  [INFERRED]
  app.js → magical-titles.js
- `setupEventListeners()` --indirect_call--> `hideMagicalTitlesDialog()`  [INFERRED]
  app.js → magical-titles.js
- `Main App HTML Shell` --references--> `About Info Icon SVG Asset`  [EXTRACTED]
  index.html → img/info.svg

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **SpecKit Workflow Suite** — _opencode_command_speckit_specify_speckit_specify_command, _opencode_command_speckit_plan_speckit_plan_command, _opencode_command_speckit_tasks_speckit_tasks_command, _opencode_command_speckit_implement_speckit_implement_command [EXTRACTED 1.00]

## Communities (57 total, 31 thin omitted)

### Community 0 - "app.js"
Cohesion: 0.06
Nodes (32): cancelTransfer(), canvas, canvasFarLeft, canvasFarRight, canvasLeft, canvasRight, canvasWrapper, convertProject() (+24 more)

### Community 1 - "updateCanvas"
Cohesion: 0.14
Nodes (39): addOverlay(), applyStyleToAll(), createProject(), deleteOverlay(), deleteProject(), drawBackground(), drawNoise(), drawOverlays() (+31 more)

### Community 2 - "build"
Cohesion: 0.06
Nodes (33): build, appId, directories, dmg, files, linux, mac, productName (+25 more)

### Community 3 - "setupEventListeners"
Cohesion: 0.13
Nodes (30): addHeadlineLanguage(), addProjectLanguage(), addSubheadlineLanguage(), applyPositionPreset(), applyTranslations(), closeLanguagesModal(), formatValue(), getTextSettings() (+22 more)

### Community 4 - "package.json"
Cohesion: 0.07
Nodes (26): electron, electron-builder, author, email, name, url, description, devDependencies (+18 more)

### Community 5 - "three-renderer.js"
Cohesion: 0.17
Nodes (20): animateThreeJS(), basePositionOffset, createRoundedScreenImage(), createScreenOverlay(), deviceConfigs, getUse3D(), initThreeJS(), loadCachedPhoneModel() (+12 more)

### Community 6 - "language-utils.js"
Cohesion: 0.13
Nodes (12): addLocalizedImage(), closeDuplicateDialog(), closeScreenshotTranslationsModal(), duplicateQueue, findScreenshotByBaseFilename(), getBaseFilename(), handleTranslationFileSelect(), initDuplicateDialogListeners() (+4 more)

### Community 7 - "speckit.analyze.md"
Cohesion: 0.08
Nodes (23): 1. Initialize Analysis Context, 2. Load Artifacts (Progressive Disclosure), 3. Build Semantic Models, 4. Detection Passes (Token-Efficient Analysis), 5. Severity Assignment, 6. Produce Compact Analysis Report, 7. Provide Next Actions, 8. Offer Remediation (+15 more)

### Community 8 - "magical-titles.js"
Cohesion: 0.31
Nodes (9): dismissMagicalTitlesTooltip(), generateMagicalTitles(), generateTitlesWithAnthropic(), generateTitlesWithGoogle(), generateTitlesWithOpenAI(), getScreenshotDataUrl(), hideMagicalTitlesDialog(), parseDataUrl() (+1 more)

### Community 9 - "renderScreenshotToCanvas"
Cohesion: 0.32
Nodes (8): drawBackgroundToContext(), drawNoiseToContext(), drawOverlaysToContext(), drawText(), drawTextToContext(), hexToRgba(), renderScreenshotToCanvas(), wrapText()

### Community 11 - "main.js"
Cohesion: 0.31
Nodes (8): { app, BrowserWindow, Menu, shell, dialog, ipcMain }, createMenu(), createWindow(), fs, isDev, path, showAboutWindow(), showPreferencesWindow()

### Community 12 - "speckit.specify.md"
Cohesion: 0.25
Nodes (7): For AI Generation, General Guidelines, Outline, Quick Guidelines, Section Requirements, Success Criteria Guidelines, User Input

### Community 14 - "llm.js"
Cohesion: 0.33
Nodes (3): generateModelOptions(), getSelectedModel(), llmProviders

### Community 15 - "dependencies"
Cohesion: 0.33
Nodes (5): @kilocode/plugin, @opencode-ai/plugin, dependencies, @kilocode/plugin, @opencode-ai/plugin

### Community 16 - "translateAllText"
Cohesion: 0.38
Nodes (7): aiTranslateAll(), setTranslateStatus(), showTranslateConfirmDialog(), translateAllText(), translateWithAnthropic(), translateWithGoogle(), translateWithOpenAI()

### Community 18 - "Main App HTML Shell"
Cohesion: 0.67
Nodes (3): About Info Icon SVG Asset, External CDN Scripts Integration, Main App HTML Shell

### Community 19 - "CLAUDE.md"
Cohesion: 0.25
Nodes (6): Agent Instructions, Architecture, Development, External Dependencies, Key Functions, Project Overview

### Community 21 - "App Store Screenshot Generator"
Cohesion: 0.08
Nodes (24): AI Translation, App Store Screenshot Generator, Apps Using This Project, Author, Backgrounds, Building locally, Credits, Device Mockups (+16 more)

### Community 25 - "createNewScreenshot"
Cohesion: 0.29
Nodes (7): createNewScreenshot(), handleFiles(), handleFilesFromElectron(), processElectronFilesSequentially(), processElectronImageFile(), processFilesSequentially(), processImageFile()

### Community 26 - "getText"
Cohesion: 0.29
Nodes (7): getText(), loadGoogleFont(), loadTextUIFromGlobal(), loadTextUIFromScreenshot(), updateFontPickerPreview(), updateSingleFontPickerPreview(), updateTextUI()

### Community 32 - "speckit.plan.md"
Cohesion: 0.29
Nodes (6): Key rules, Outline, Phase 0: Outline & Research, Phase 1: Design & Contracts, Phases, User Input

### Community 33 - "Task Generation Rules"
Cohesion: 0.29
Nodes (6): Checklist Format (REQUIRED), Outline, Phase Structure, Task Generation Rules, Task Organization, User Input

### Community 34 - "getScreenshotSettings"
Cohesion: 0.53
Nodes (6): drawDeviceFrame(), drawDeviceFrameToContext(), drawScreenshot(), drawScreenshotToContext(), getScreenshotSettings(), roundRect()

### Community 35 - "renderFontList"
Cohesion: 0.33
Nodes (6): fetchAllGoogleFonts(), initFontPicker(), initSingleFontPicker(), renderFontList(), setTextSetting(), setTextValue()

### Community 36 - "speckit.checklist.md"
Cohesion: 0.33
Nodes (5): Anti-Examples: What NOT To Do, Checklist Purpose: "Unit Tests for English", Example Checklist Types & Sample Items, Execution Steps, User Input

### Community 37 - "exportAll"
Cohesion: 0.60
Nodes (5): exportAll(), exportAllForLanguage(), exportAllLanguages(), hideExportProgress(), showExportProgress()

## Knowledge Gaps
- **184 isolated node(s):** `@kilocode/plugin`, `@opencode-ai/plugin`, `state`, `languageFlags`, `googleFonts` (+179 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **31 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `setupEventListeners()` connect `setupEventListeners` to `app.js`, `updateCanvas`, `getScreenshotSettings`, `renderFontList`, `exportAll`, `language-utils.js`, `magical-titles.js`, `translateAllText`, `createNewScreenshot`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `handleTranslationFileSelect()` connect `language-utils.js` to `setupEventListeners`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `closeScreenshotTranslationsModal()` connect `language-utils.js` to `setupEventListeners`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 8 inferred relationships involving `setupEventListeners()` (e.g. with `addOverlay()` and `closeLanguagesModal()`) actually correct?**
  _`setupEventListeners()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **What connects `@kilocode/plugin`, `@opencode-ai/plugin`, `state` to the rest of the system?**
  _184 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._
- **Should `updateCanvas` be split into smaller, more focused modules?**
  _Cohesion score 0.13765182186234817 - nodes in this community are weakly interconnected._