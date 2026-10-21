# PSS Console

A fullscreen PS5-style Games/Media launcher for Windows 11. Version 1.2 adds game launch transitions and an in-game control center, with a charcoal/silver reference theme, SST typography, supplied PS5 sound cues, and a fully custom native setup/uninstall wizard. It runs above the normal Windows desktop, launches real installed PC games and streaming sites, and uses your default browser (Brave on this PC).

## Run

Use `PSS-Console-Setup-1.2.0-x64.exe` for a per-user installation and desktop shortcut. Opening the installed app enables startup after Windows sign-in by default. Change this under Settings → Launch at sign-in. The portable ZIP is also available; extract it completely before running PSS Console.exe. Retain it at a stable location if startup is enabled.

**Return to Windows:** select Windows in the footer/control center, or press **Ctrl + Alt + D**. Your games/apps remain open. Controller mouse mappings stop. Reopen PSS from its tray icon, desktop shortcut, or **Ctrl + Alt + Home**. The control center also offers Quit PSS Console, which exits the launcher/helper completely.

## Controls

| Action | Controller | Keyboard / mouse |
|---|---|---|
| Navigate | D-pad / left stick | Arrow keys / Tab / mouse |
| Select | Cross / A | Enter / click |
| Back | Circle / B | Escape |
| Games / Media | L1 / R1 or LB / RB | Click top tabs |
| Favorite selected game | Square / X | Tile options → Favorite |
| Search | Triangle / Y | F2 / search icon |
| Control center | Options / Menu | F1 / PSS footer icon |
| Console menu over a running app | Guide button when available, or hold Options + Create / Menu + View for 1 second | Ctrl + Alt + Home |
| Return to Windows | Control center → Windows | Ctrl + Alt + D |
| Browser pointer | Left stick | Mouse |
| Browser scroll | Right stick | Wheel |
| Browser click | Cross / A | Click |
| Browser back | Circle / B | Alt + Left |
| Browser keyboard | Triangle / Y | Ctrl + Alt + K |

Controller pointer mappings operate only while a recognized browser is foreground and PSS is in browser mode. Games retain their native controller input. When using DualSenseX, PSS prefers a detected physical PlayStation device over a simultaneous virtual Xbox device; only one device drives shell input.

## Games

Installed games import from available Steam libraries, Epic manifests, Riot installation metadata, GOG launch tasks, Ubisoft game registrations, Xbox/MSIX game configuration, and recognized EA/Battle.net shortcuts/registrations. Some launcher metadata only identifies a candidate executable; those finds require review instead of guessing a launch target.

Open Game Library → Scan to review other discovered shortcuts. Settings → Game folders → Add folder searches up to three directory levels for standalone `.exe` and `.lnk` files, excluding common installers, uninstallers and crash handlers. Pick the actual game in the review list, or use Add Game to choose a file directly. Launch arguments support quoted values. Shortcuts retain their own arguments and working directory.

Tile options allow favorites, custom covers/backgrounds, and removing a tile without uninstalling the game. Removed tiles stay hidden on later scans/startups; add the game manually to restore it.

Valorant starts through Riot Client using its product and patchline arguments, preserving Riot authentication and anti-cheat startup. The shell does not emulate PS5 games or PlayStation Network.

## Media and browser

Default tiles: Netflix, Spotify, Prime Video, YouTube, HBO/Max, Jellyfin, Browser. Add other services using Add → Website / service.

Brave is detected from Windows' default browser registration. Media opens a new fullscreen browser window with the existing profile and logins. Browser tile also exposes Address or search. To enter text into a focused website field using the controller, open Browser keyboard, type, then choose Send or Enter. For shell form fields, Cross/A opens the on-screen keyboard.

Existing Jellyfin on this PC responds at `http://127.0.0.1:8096`. Change the server address under Settings if needed. PSS installs no Jellyfin server.

Subscription, region, account and DRM requirements remain those of each service. Browser launch and native text entry are tested; authenticated protected-video playback must be checked with your accounts.

## Data and recovery

Library/settings and cached artwork are stored under `%APPDATA%\pss-console`. Browser credentials stay in the browser profile. Diagnostic messages are in `diagnostics.log` alongside the library; logs rotate at roughly 1 MB. Uninstall removes the PSS startup entry and leaves Windows Explorer and game installations intact. User library data is preserved for reinstall.

PSS stays a normal per-user application. Windows may limit focus switching over elevated apps and exclusive-fullscreen games. Use the keyboard home/desktop shortcuts or Alt + Tab when needed. Power actions require explicit confirmation in PSS.

## Development

Requires Node.js 22+, npm, .NET 10 SDK, Windows x64. Packaged builds bundle the .NET helper runtime and SDL3.

```powershell
npm ci
npm run assets:local
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-assets.ps1
npm run helper
npm run build
npm start
```

`npm run helper` downloads an official SDL3 x64 release, verifies its GitHub SHA-256 digest when supplied, and builds the self-contained helper. The bundled build records the SDL release in `native/sdl-version.json`.

```powershell
npm test
npm run smoke
node tests/integration.cjs
node tests/standalone.cjs
node tests/performance.cjs
npm run package
```

Smoke/integration tests use a separate workspace test profile. Integration opens a temporary local page in real Brave, tests text entry, then closes only that test window. Standalone tests build a temporary WinForms game probe, verify executable/shortcut arguments and working directory, then close/remove those test entries. No real game session or subscription purchase is started.

Desktop renderer uses React/TypeScript; Electron owns validated launch/storage operations; a private stdin/stdout JSON channel connects the .NET helper. Renderer Node integration is disabled and web content stays in the external browser.

## Custom setup, assets, and performance

Setup is a WPF application with six custom screens, keyboard/controller navigation, real extraction progress, package SHA-256 verification, safe destination validation, staging/rollback, startup/shortcut preferences, and a matching custom uninstaller. No NSIS or stock setup pages are used. Preview all setup screens without installing:

```powershell
dotnet run --project installer/PssSetup.csproj -- --capture-all=C:\Temp\PSS-Setup-Previews
```

The public source repository excludes the SST font files and PS5 sound recordings. Supply your own local copies using `npm run assets:local`; pass `-FontDirectory` and `-SoundDirectory` to `scripts/import-assets.ps1` for other locations. The built local app and setup include the supplied files. The importer maps Move, Select, Back, and Startup from the PS5 V2 folder. No synthesized replacement sounds are used.

There are no constantly animated particles, videos, canvas effects, full-screen blur filters, or animated layout properties. Focus uses a 130 ms transform; backdrops use a 200 ms opacity fade. Clock updates pause while hidden. Helper polling backs off on the desktop and without a controller.

## Game sessions

Launch shows a short artwork transition while the game or its launcher opens. PSS stays running in the background. Games use their own fullscreen/borderless setting. Press Ctrl + Alt + Home, the controller Guide button (when Windows exposes it), or hold Options + Create / Menu + View for one second to open the compact control center. Resume returns to the same app without relaunching; Home opens the full library, where the game shows Resume Game. Close game asks for confirmation and sends a normal close request, allowing the game to show its own save/exit dialog.

The overlay does not pause games or suppress their native background controller input. Windowed/borderless games work best; exclusive fullscreen may switch to the desktop or minimize the game when Windows activates the menu. No DLL injection, game embedding, process suspension, or anti-cheat modification is used. Controller mouse/keyboard mapping stays off in game mode.

When the active tracked game exits, PSS returns home even if other apps remain open. Brief window replacement/loading is tolerated. Return to Windows disables automatic restoration and removes overlay topmost status, leaving launched apps running.

Run session regressions with `node tests/console-flow.cjs`. They use temporary native Windows probe apps, not installed games or account sessions. Physical controller and exclusive-fullscreen game checks remain manual.
