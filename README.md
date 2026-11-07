# Rig Studio

**English** | [简体中文](README.zh-CN.md)

A desktop workspace for **3D rigging, animation retargeting, and model editing with local Blender**. Connect models on a node canvas, ask an Agent to edit them, and compare the results.

This open-source edition is based on the standalone **v0.3.0** application. **v0.3.1 adds English and Simplified Chinese interfaces**, with English as the default.

- **No platform account or sign-in.** No platform credits, memberships, or cloud project storage.
- **Bring your own keys.** Connect an OpenAI-compatible API, and optionally Tripo or Meshy.
- **Keep projects locally.** Model files, canvas history, binding plans, scripts, and Blender projects stay on your computer.
- **Windows and macOS build targets.** Blender is installed separately; it is not bundled.

## What you can do

- Import an animated GLB as the motion source and another GLB as the desired appearance.
- Connect source, target, generation, binding, editing, and result nodes. Branch to keep alternative versions.
- Fit a skeleton, adjust joints, transfer selected animations, decimate eligible meshes, and bake/export with local Blender.
- Let an Agent inspect and edit mesh regions, bones, weights, UVs, materials, shape keys, and animations using Blender Python.
- Compare up to three models with synchronized animation progress and camera views, skeleton overlays, pause, slow playback, and display normalization.
- Switch to the classic workbench for detailed joint and binding-plan editing.

Expression creation is an editing task, not an automatic guarantee of animation transfer. Results depend on topology, proportions, textures, and the model used by the Agent. Inspect motion and facial close-ups before accepting a result.

## Quick start from source

Install **Node.js 24 or newer**, **npm**, and **Blender 4.2+**. Blender 4.5 LTS is the baseline used by the original local validation scripts. macOS builds are supported by the packaging configuration but have not been validated on physical Mac hardware in this release.

```bash
git clone https://github.com/laputacn/RigStudio.git
cd RigStudio
npm ci
npm run build
npm start
```

Alternatively, run `start-windows.cmd` on Windows or `start-macos.command` on macOS after installing Node.js. These launchers install dependencies if needed, build the UI, and start the app.

For development:

```bash
npm run dev
```

This starts Vite and Electron together. `npm run dev:web` opens a **UI-only preview**; importing local models and running Blender require the desktop app.

## Configure the workspace

Open **Settings** and select your Blender executable:

- Windows: `blender.exe` from your Blender installation.
- macOS: `/Applications/Blender.app/Contents/MacOS/Blender`.
- Linux development: a local Blender executable.

For Agent assistance, enter an API base URL, model ID, and your own API key. Choose a model that supports image input and tool calls. The app supports Responses and Chat Completions; automatic mode selects Responses for the official OpenAI endpoint and Chat Completions for compatible endpoints. The connection test checks a text request and does not validate all model capabilities.

Tripo and Meshy keys are optional and only needed for their generation nodes. This historical version supports text-to-3D generation with the provider adapters included in the source. Availability and accepted model versions depend on the provider; the model ID can be edited in the generation node. Current image and multiview workflows from later applications are not included here.

### Language

Choose **English** or **简体中文** in the canvas header, the classic workbench header, or Settings. The first launch uses English regardless of OS language. Your selection persists on this device.

Switching languages updates the interface without reloading a workspace or clearing settings drafts. Model names, filenames, prompts, scripts, animation names, and conversation messages remain unchanged. Ask the Agent to reply in your preferred language when needed.

## A typical workflow

1. Import an animated **source model** and a **target model** whose appearance you want to keep.
2. Create a **binding node**. Connect the source to its Source input and the target to its Target input.
3. Create a local draft or ask the Agent to inspect the models and propose a binding plan.
4. Check joints and orientation, select animation clips, and run binding.
5. Add the result to comparison. Inspect multiple animation phases and camera angles.
6. Create a branch or an editing node for another revision. Keep earlier results for comparison.

Example Agent requests:

> Inspect the shoulder and arm geometry. Lengthen both arms by 15%, preserve a smooth shoulder transition, and check the textures. Save a new version.
>
> Compare the run animation at 25%, 50%, and 75%. Inspect neck and chest weights, then create a corrected version.
>
> Add blinking and mouth-opening shape keys to this version. Preserve the existing body animations and inspect the face close up.

The Agent runs Blender Python in a background process. It does not operate Blender's graphical interface. Scripts that require a particular UI context or an unavailable add-on may not work.

## Local data, API usage, and execution limits

The workspace is stored in Electron's application data directory under `workspace`. Settings, models, node graphs, history, and output versions are local. An optional `RIG_STUDIO_DATA` environment variable selects a separate application data directory; tests use it to avoid touching your normal workspace.

Conversations, structural reports, and requested inspection images are sent to the API endpoint you configure. Generation providers receive submitted prompts. Original GLB files are not uploaded to the conversation API by default. This is **local model processing**, not an offline language model.

Keys stay in the Electron main process. You can opt into encrypted persistence using OS secure storage. When secure storage is unavailable, use session-only keys. Keys are not intended to be written into exported model files or task logs.

The default Agent limit is **24 model-decision steps** and **6 Blender editing/binding attempts per turn**. Step presets are 12, 24, and 48, with custom limits. Completed outputs remain available when a limit is reached.

**A step limit is not a spending cap.** This historical branch does not include later token-budget or monetary-budget protections. Reports, history, and images can produce substantial API input usage. Use provider-side spending limits and begin with small tasks. API connection tests also make a billable model request. Stopping local polling does not necessarily cancel a provider's remote generation task.

Edits run against copies and export a separate GLB, a packed `.blend` project, scripts, logs, and inspection results. Data checks catch certain export and skinning failures; they do not establish visual quality. Script checks are safeguards, **not an OS security sandbox**. Run only scripts and model-generated changes you trust.

## Build desktop packages

```bash
# Windows ZIP
npm run dist:win:portable

# Windows installer
npm run dist:win

# macOS DMG, on a Mac
npm run dist:mac

# macOS ZIPs for Apple Silicon and Intel
npm run dist:mac:portable
```

Build outputs go to `release/`. Code signing and macOS notarization require the maintainer's own signing configuration. This repository does not include signing credentials or Blender binaries.

## Tests

```bash
npm test
npm run build
npm run test:ui
```

Unit tests cover binding plans, API adapters, secret persistence, cancellation, tool limits, graph connections, branches, independent history, generation-task resumption, and translation coverage. Tests use local fixtures and simulated APIs, not paid generation services.

The Electron UI test uses an isolated temporary profile and checks both languages, draft preservation, node interactions, native dialogs, and restart persistence. Set `ELECTRON_PATH` if you want to use a separately installed Electron executable. For Linux root-only test environments, `RIG_TEST_NO_SANDBOX=1` explicitly disables the test sandbox; it is not a normal launch setting.

`tests/fixtures/character.glb` is a small synthetic character with a Wave animation, generated with `scripts/make-editor-fixture.py`. No proprietary character assets or user models are included.

## Project layout

| Directory | Purpose |
|---|---|
| `src/` | React canvas, classic workbench, Agent panel, Three.js preview |
| `desktop/` | Electron IPC, local storage, API adapters, Agent and node execution |
| `blender/` | Background rigging, editing, inspection, and export scripts |
| `shared/` | Shared translation utilities and English catalog |
| `tests/` | Local fixtures, unit tests, and Electron UI validation |

## Contributing and license

Issues and pull requests are welcome. Include reproduction steps, operating system, Blender version, and a minimal sample you are allowed to share. Remove keys, private project paths, and sensitive prompts from reports.

Project code is licensed under the [MIT License](LICENSE). Third-party libraries retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Blender is a separately installed application with its own license.
