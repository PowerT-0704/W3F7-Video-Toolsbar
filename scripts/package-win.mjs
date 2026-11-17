import { packager } from '@electron/packager'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cp, copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const meta = JSON.parse(await readFile('package.json', 'utf8'))
const artifacts = resolve('artifacts')
await mkdir(artifacts, { recursive: true })

const tempRoot = await realpath(tmpdir())
const scratch = await mkdtemp(join(tempRoot, 'W3F7-pack-'))
const stage = join(scratch, 'application')
const application = 'W3F7-Video-Toolsbar'
const filename = application + '-' + meta.version + '-win-x64.zip'
const zip = join(artifacts, filename)
const temporary = join(artifacts, '.w3f7-' + randomUUID() + '.partial.zip')

try {
  await mkdir(stage)
  for (const entry of ['dist', 'dist-electron']) {
    await cp(entry, join(stage, entry), { recursive: true })
  }
  await writeFile(join(stage, 'package.json'), JSON.stringify({
    name: meta.name, productName: application, version: meta.version, main: meta.main,
  }))
  const [bundle] = await packager({
    dir: stage, out: join(scratch, 'unpacked'), name: application, platform: 'win32', arch: 'x64',
    electronVersion: require('electron/package.json').version,
    electronZipDir: process.env.W3F7_ELECTRON_ZIP_DIR || undefined,
    asar: true, extraResource: resolve('core'), prune: false,
  })
  for (const entry of ['W3F7-Video-Cover.bat', 'README.md', 'ROADMAP.md']) {
    await copyFile(entry, join(bundle, entry))
  }
  await cp('docs', join(bundle, 'docs'), { recursive: true })
  await cp('licenses', join(bundle, 'licenses'), { recursive: true })

  const command = "Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:W3F7_BUNDLE, $env:W3F7_ZIP, [IO.Compression.CompressionLevel]::Optimal, $true)"
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, W3F7_BUNDLE: bundle, W3F7_ZIP: temporary }, stdio: 'inherit', windowsHide: true,
  })
  await rename(temporary, zip)
  console.log(zip)
} finally {
  await rm(temporary, { force: true })
  const resolvedScratch = await realpath(scratch)
  if (dirname(resolvedScratch) === tempRoot) {
    await rm(resolvedScratch, { recursive: true, force: true })
  }
}
