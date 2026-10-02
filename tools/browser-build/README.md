# Browser startup build

This toolchain is development-only. The server and hot-update payload do not install or run esbuild.

One-time setup: `npm ci --prefix tools/browser-build`.

After editing browser JavaScript, styles or index.html, run from the repository root:

```powershell
python scripts/build-browser-module-versions.py
node scripts/build-browser-startup.mjs
```

`index.html` remains the editable source page and can be opened directly for module-level debugging. Public `/versus/` and `/game` serve generated `game.html`, `game-startup.js` and `game-startup.css`. Commit all three generated artifacts alongside source changes. The incremental release builder checks for stale output before packaging.

The build canonicalizes legacy import query strings, preserves module-relative image URLs and stylesheet order, and retains third-party license comments. The server compresses public code with a bounded cache and only grants immutable caching when the supplied content hash matches the bytes on disk. HTML is always revalidated.

Validation: `node scripts/review-browser-startup.mjs`, `node scripts/review-pack-full-game.mjs`, and the Electron script `windows-client/review-startup-bundle.cjs`. All use isolated local test state.
