#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const DESKTOP_DIR = path.join(ROOT, 'desktop');
const DIST_DIR = path.join(ROOT, 'dist');
const OUT_DIR = path.join(ROOT, 'public', 'downloads');
const OUT_EXE = path.join(OUT_DIR, 'cycle.exe');

const ELECTRON_ZIP = '/tmp/electron-v33.2.1-win32-x64.zip';
const TOOLS_DIR = '/tmp/cycle-tools/node_modules';
const STAGE_APP_DIR = '/tmp/cycle-app-stage/app';
const UNPACKED_DIR = '/tmp/cycle-win-unpacked';

const SKIP_FILES = new Set(['.nojekyll', 'sw.js', 'registerSW.js', '404.html']);
const SKIP_PREFIXES = ['downloads/', 'uploads/'];

function copyFilteredWebDist(srcDir, destDir, relPrefix = '') {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_PREFIXES.some((p) => `${rel}/`.startsWith(p))) continue;
      copyFilteredWebDist(srcPath, destPath, rel);
    } else {
      if (SKIP_FILES.has(rel)) continue;
      if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
      if (rel.startsWith('workbox-') && rel.endsWith('.js')) continue;
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function main() {
  if (!fs.existsSync(ELECTRON_ZIP)) {
    console.log('Downloading Electron win32-x64 runtime...');
    execSync(
      `curl -fsSL -L -o "${ELECTRON_ZIP}" https://github.com/electron/electron/releases/download/v33.2.1/electron-v33.2.1-win32-x64.zip`,
      { stdio: 'inherit' }
    );
  }

  if (!fs.existsSync(path.join(TOOLS_DIR, 'resedit'))) {
    fs.mkdirSync('/tmp/cycle-tools', { recursive: true });
    execSync('npm install --prefix /tmp/cycle-tools --no-save resedit @electron/asar', {
      stdio: 'inherit',
    });
  }

  const asar = await import(path.join(TOOLS_DIR, '@electron/asar/lib/asar.js'));
  const ResEdit = await import(path.join(TOOLS_DIR, 'resedit/dist/index.js'));

  console.log('1. Building web bundle with relative ./ paths...');
  execSync('npx vite build --base=./', {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_BASE_PATH: './' },
  });

  console.log('2. Staging desktop app package...');
  fs.rmSync('/tmp/cycle-app-stage', { recursive: true, force: true });
  fs.mkdirSync(path.join(STAGE_APP_DIR, 'assets'), { recursive: true });

  fs.writeFileSync(
    path.join(STAGE_APP_DIR, 'package.json'),
    JSON.stringify(
      {
        name: 'cycle-exe',
        productName: 'Cycle.exe',
        version: '1.0.2',
        description: 'Cycle.exe Desktop Software',
        main: 'main.cjs',
      },
      null,
      2
    )
  );
  fs.copyFileSync(path.join(DESKTOP_DIR, 'main.cjs'), path.join(STAGE_APP_DIR, 'main.cjs'));
  fs.copyFileSync(path.join(DESKTOP_DIR, 'preload.cjs'), path.join(STAGE_APP_DIR, 'preload.cjs'));
  fs.copyFileSync(
    path.join(DESKTOP_DIR, 'assets', 'icon.ico'),
    path.join(STAGE_APP_DIR, 'assets', 'icon.ico')
  );
  fs.copyFileSync(
    path.join(DESKTOP_DIR, 'assets', 'icon.png'),
    path.join(STAGE_APP_DIR, 'assets', 'icon.png')
  );
  copyFilteredWebDist(DIST_DIR, path.join(STAGE_APP_DIR, 'web-dist'));

  console.log('3. Unpacking Electron Windows runtime...');
  fs.rmSync(UNPACKED_DIR, { recursive: true, force: true });
  fs.mkdirSync(UNPACKED_DIR, { recursive: true });
  execSync(`unzip -q "${ELECTRON_ZIP}" -d "${UNPACKED_DIR}"`, { stdio: 'inherit' });

  // Trim unneeded locale .pak files (keep en-US.pak)
  const localesDir = path.join(UNPACKED_DIR, 'locales');
  if (fs.existsSync(localesDir)) {
    for (const file of fs.readdirSync(localesDir)) {
      if (file.toLowerCase() !== 'en-us.pak') {
        fs.unlinkSync(path.join(localesDir, file));
      }
    }
  }

  // Remove default electron app
  const defaultAsar = path.join(UNPACKED_DIR, 'resources', 'default_app.asar');
  if (fs.existsSync(defaultAsar)) fs.unlinkSync(defaultAsar);

  console.log('4. Packing Cycle.exe app into resources/app.asar...');
  await asar.createPackage(STAGE_APP_DIR, path.join(UNPACKED_DIR, 'resources', 'app.asar'));

  console.log('5. Renaming electron.exe -> cycle.exe and embedding Cycle.exe icon & metadata...');
  const origExe = path.join(UNPACKED_DIR, 'electron.exe');
  const innerExe = path.join(UNPACKED_DIR, 'cycle.exe');
  fs.renameSync(origExe, innerExe);

  const exeBuf = fs.readFileSync(innerExe);
  const exe = ResEdit.NtExecutable.from(exeBuf);
  const res = ResEdit.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(
    fs.readFileSync(path.join(DESKTOP_DIR, 'assets', 'icon.ico'))
  );
  const iconGroups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const targetIconId = iconGroups.length > 0 ? iconGroups[0].id : 1;
  const targetIconLang = iconGroups.length > 0 ? iconGroups[0].lang : 1033;

  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    targetIconId,
    targetIconLang,
    iconFile.icons.map((i) => i.data)
  );

  const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const vi = viList.length > 0 ? viList[0] : ResEdit.Resource.VersionInfo.createEmpty();
  const langs = vi.getAvailableLanguages();
  const langObj = langs.length > 0 ? langs[0] : { lang: 1033, codepage: 1200 };
  vi.setStringValues(langObj, {
    CompanyName: 'Cycle.exe',
    FileDescription: 'Cycle.exe Desktop Software',
    FileVersion: '1.0.2.0',
    InternalName: 'cycle.exe',
    LegalCopyright: 'Cycle.exe 2026',
    OriginalFilename: 'cycle.exe',
    ProductName: 'Cycle.exe',
    ProductVersion: '1.0.2.0',
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(innerExe, Buffer.from(exe.generate()));

  console.log('6. Packaging standalone single-file public/downloads/cycle.exe via NSIS LZMA...');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  execSync(`makensis -V2 "${path.join(DESKTOP_DIR, 'cycle-portable.nsi')}"`, {
    cwd: ROOT,
    stdio: 'inherit',
  });

  // Cleanup temp staging folders
  fs.rmSync('/tmp/cycle-app-stage', { recursive: true, force: true });
  fs.rmSync(UNPACKED_DIR, { recursive: true, force: true });

  const sizeMb = (fs.statSync(OUT_EXE).size / (1024 * 1024)).toFixed(2);
  console.log(`Built standalone desktop software: ${OUT_EXE} (${sizeMb} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
