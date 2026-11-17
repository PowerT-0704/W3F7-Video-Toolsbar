import { packager } from '@electron/packager'
import { execFileSync } from 'node:child_process'
import { cp, copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const meta = JSON.parse(await readFile('package.json', 'utf8'))
const artifacts = resolve('artifacts')
await mkdir(artifacts, { recursive: true })
const stage = await mkdtemp(join(artifacts, 'pack-stage-'))
const application = 'W3F7-Video-Toolsbar'
const filename = application + '-' + meta.version + '-win-x64.zip'
try {
  for (const entry of ['dist', 'dist-electron']) {
    await cp(entry, join(stage, entry), { recursive: true })
  }
  await writeFile(join(stage, 'package.json'), JSON.stringify({
    name: meta.name, productName: application, version: meta.version, main: meta.main,
  }))
  const [bundle] = await packager({
    dir: stage, out: join(artifacts, 'win-unpacked'), name: application, platform: 'win32', arch: 'x64',
    electronVersion: require('electron/package.json').version,
    electronZipDir: process.env.W3F7_ELECTRON_ZIP_DIR || undefined,
    extraResource: resolve('core'),
    overwrite: true, prune: false,
  })
  await copyFile('W3F7-Video-Cover.bat', join(bundle, 'W3F7-Video-Cover.bat'))
  await copyFile('README.md', join(bundle, 'README.md'))
  await copyFile('ROADMAP.md', join(bundle, 'ROADMAP.md'))
  await cp('docs', join(bundle, 'docs'), { recursive: true })
  await cp('licenses', join(bundle, 'licenses'), { recursive: true })
  const zip = join(artifacts, filename)
  const temporary = join(stage, filename)
  const command = "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:W3F7_BUNDLE, $env:W3F7_ZIP, [IO.Compression.CompressionLevel]::Optimal, $true)"
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, W3F7_BUNDLE: bundle, W3F7_ZIP: temporary }, stdio: 'inherit', windowsHide: true,
  })
  await rename(temporary, zip)
  console.log(zip)
} finally {
  // Only remove the staging directory created above.
  const target = relative(await realpath(artifacts), await realpath(stage))
  if (target.startsWith('pack-stage-') && !target.includes('..') && !isAbsolute(target)) {
    await rm(stage, { recursive: true, force: true })
  }
}
