# Cycle.exe Windows Desktop Software (`cycle.exe`)

This folder packages **Cycle.exe 2.0** as an independent standalone Windows desktop executable (**`cycle.exe`**) with its own native window and runtime (no external browser required).

## Option 1: Build Standalone `cycle.exe` Directly (Linux / CI / Windows)
```bash
node desktop/build-exe.mjs
```
Outputs the self-contained Windows executable at `public/downloads/cycle.exe`.

## Option 2: Build Automatically via GitHub Actions
1. Push your repository to GitHub.
2. Open **Actions → Build Windows cycle.exe** and click **Run workflow**.
3. When the Windows runner finishes, download **`Cycle.exe-Windows-Executable`** from the workflow run artifacts (containing `cycle.exe` portable and `Cycle.exe-Setup-1.0.0.exe`).

## Option 3: Build Locally on Windows via Electron Builder
Requirements: [Node.js 20+](https://nodejs.org/) installed on Windows.

```powershell
# 1. Build the web app from the repository root
npm install
npm run build:desktop-web

# 2. Build cycle.exe inside desktop/
cd desktop
npm install
npm run build:exe
```

Your executables will be generated at:
- `desktop/dist/cycle.exe` (Standalone portable Windows software)
- `desktop/dist/Cycle.exe-Setup-1.0.0.exe` (Windows NSIS installer with Desktop & Start Menu shortcuts)
