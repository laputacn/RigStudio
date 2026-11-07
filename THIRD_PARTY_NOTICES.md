# Third-party notices

Rig Studio's own source is licensed under the MIT license in `LICENSE`. This
does not change the licenses of its dependencies or user-imported models.

The renderer uses React, React DOM, React Flow (`@xyflow/react`), and Three.js
under MIT, and Lucide React under ISC. Their full license and copyright notices,
including installed transitive dependencies, are in
[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt). The build regenerates this
file from the installed packages and includes it in desktop packages.

Electron is MIT-licensed and includes Chromium and other components under their
own licenses. Keep the license files supplied by Electron alongside distributed
applications. Development tools include Vite and electron-builder (MIT), and
TypeScript and Playwright (Apache-2.0). Their installed packages contain their
license texts; exact versions are recorded in `package-lock.json`.

Blender is installed separately and is not included in this repository or its
desktop packages. The included Python scripts call the user's Blender
installation. The small GLB in `tests/fixtures` is generated from simple geometry
by this project's fixture script; no commercial character assets are included.

OpenAI-compatible services, Tripo, and Meshy are external services configured by
the user. Their service terms, fees, and generated-asset rights are separate from
this repository's software license. No API credentials are included.
