# Web deployment

`uni-sim` is already a browser app. The local `npm run dev` flow is only for development; a hosted production build lets viewers open a URL with no Git clone, no Node install, and no localhost.

## Best options

- **Vercel**: import the GitHub repo, keep the detected Vite settings, deploy. `vercel.json` pins `npm run build` and `dist`.
- **Netlify**: import the GitHub repo, deploy. `netlify.toml` pins the same build command and output folder.
- **GitHub Pages**: enable Pages for GitHub Actions, then run the `Deploy static app to GitHub Pages` workflow or merge to `main`.

## What users download

They do not download a desktop app. Their browser still downloads the compiled JavaScript, textures, and WebGL shaders, exactly like any web app. That is fine for normal use; it is not the same as installing dependencies or running a local dev server.

## Performance expectations

The simulation is client-side WebGL, so hosting does not move the computation to a server. A low-end phone still has to run the render loop locally. The quality selector helps:

- **Low** caps device pixel ratio at 1 and disables gravitational lensing.
- **Medium** caps pixel ratio at 1.5 and keeps limited lensing. This is the hosted default on most desktop/laptop browsers.
- **High** caps at 2 and keeps the full visual lensing pass.

Future upgrades that would help heavier scenes: move N-body and substrate stepping into Web Workers, add object-count presets per regime, and lazy-load the anchor scenes only when selected.
