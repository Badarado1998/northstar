# Desktop release guide

The desktop app is still built with the existing Tauri scripts. `productName` remains `PandaCode` and the identifier remains `ai.pandacode.desktop`. Changing either one renames artifacts and the on-disk data directory. Do that only together with `scripts/release/common.mjs` and `packages/npx/installer.mjs`.

The visible name is `brand.json` `productName` (`Northstar` until a final name is chosen). The window title in `tauri.conf.json` matches it.

## Branding

Edit `brand.json` for the API origin, website, support URL, update endpoint, and download URLs. Empty download strings make the website say the installer is not published. Do not point those URLs at upstream PandaCode installers and present them as this product.

Attribution required by the license: "This is a fork of PandaCode" and https://github.com/aicodeking/pandacode. It is on the website footer, the licenses page, About, and the README.

## Updates

`tauri.conf.json` `plugins.updater.endpoints` must stay equal to `brand.json` `updateEndpoint`. The test in `tests/open-source.test.mjs` checks that, and checks that the endpoint is not the upstream GitHub `latest.json`.

The committed `pubkey` is still the upstream PandaCode minisign public key. Before the update host serves files:

1. Generate a new minisign keypair on a machine that is not the repository.
2. Put only the public key in `plugins.updater.pubkey`.
3. Keep the private key in the release environment. Do not commit it. `.gitignore` already ignores `*.key` and `*.pem`.
4. Sign updater artifacts with that key. Tauri will reject updates signed by the old key once the app ships with the new public key, so the first Northstar build and its `latest.json` must use the same key.

`https://updates.northstar.invalid/desktop/latest.json` is a placeholder. Update checks fail closed until a real host replaces it. That is preferable to installing upstream builds.

## Installers

The existing release workflow builds macOS Apple silicon, Windows x64, and Linux x64. Intel Mac and Windows arm64 packages are not produced by that workflow today. `brand.json` has slots for them; leave the URLs empty until those builds exist.

This change did not run a release build, did not sign a binary, and did not notarize a macOS app. Follow `docs/releasing.md` for the Tauri commands when an operator asks to ship. Code signing certificates stay outside the repository.

## Account service baked into the app

`saas.rs` compiles `brand.json` into the binary with `include_str!`. A desktop build talks to the `apiBaseUrl` from the commit it was built from. Local development uses `http://127.0.0.1:3000`. Production builds need the public HTTPS origin in that file before `tauri build`.

Refresh tokens are written only to the OS keychain. They are not in SQLite and not in a config file.
