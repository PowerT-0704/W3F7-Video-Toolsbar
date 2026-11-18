import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, copyFile, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const meta = JSON.parse(await readFile('package.json', 'utf8'))
const application = 'W3F7-Video-Toolsbar'
const artifacts = resolve('artifacts')
const portable = join(artifacts, `${application}-${meta.version}-win-x64.zip`)
const installer = join(artifacts, `${application}-${meta.version}-Setup-x64.exe`)

async function findCompiler() {
  if (process.env.W3F7_MAKENSIS) return resolve(process.env.W3F7_MAKENSIS)
  const candidates = (process.env.PATH || '').split(';').filter(Boolean).map((folder) => join(folder, 'makensis.exe'))
  for (const folder of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
    if (folder) candidates.push(join(folder, 'NSIS', 'makensis.exe'))
  }
  if (process.env.LOCALAPPDATA) {
    const cache = join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache')
    for (const folder of await readdir(cache).catch(() => [])) {
      if (!folder.startsWith('nsis-')) continue
      const parent = join(cache, folder)
      candidates.push(join(parent, 'makensis.exe'))
      for (const child of await readdir(parent).catch(() => [])) candidates.push(join(parent, child, 'makensis.exe'))
    }
  }
  for (const candidate of candidates) {
    try {
      await access(join(dirname(candidate), 'Include', 'MUI2.nsh'))
      await access(candidate)
      return candidate
    } catch { /* Try the next installed compiler. */ }
  }
  throw new Error('需要 NSIS 3。请将 makensis.exe 加入 PATH，或设置 W3F7_MAKENSIS 为其绝对路径。')
}

function quote(value) {
  if (/[\r\n]/.test(value)) throw new Error('安装包路径包含换行。')
  return '"' + value.replaceAll('$', '$$').replaceAll('"', '$\\"') + '"'
}

async function listFiles(root, relative = '') {
  const files = []
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = join(relative, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(root, path))
    else if (entry.isFile()) files.push(path)
    else throw new Error(`安装包中包含不支持的文件类型：${path}`)
  }
  return files.sort()
}

await access(portable).catch(() => { throw new Error('未找到当前版本便携 ZIP，请先运行 npm run package:win。') })
const compiler = await findCompiler()
const tempRoot = await realpath(tmpdir())
const scratch = await mkdtemp(join(tempRoot, 'w3f7-installer-'))
const temporary = join(artifacts, `.w3f7-${randomUUID()}.partial.exe`)

try {
  const command = 'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:W3F7_PORTABLE, $env:W3F7_UNPACKED)'
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, W3F7_PORTABLE: portable, W3F7_UNPACKED: join(scratch, 'unpacked') }, windowsHide: true, stdio: 'inherit',
  })
  const payload = join(scratch, 'unpacked', application + '-win32-x64')
  await access(join(payload, application + '.exe'))
  for (const file of ['README.md', 'ROADMAP.md', 'LICENSE', 'docs/verification.md']) {
    await copyFile(file, join(payload, file))
  }
  const files = await listFiles(payload)
  const directories = new Set()
  const copy = []
  const remove = []
  let size = 0
  for (const file of files) {
    const source = join(payload, file)
    const folder = dirname(file)
    copy.push(`SetOutPath ${quote(folder === '.' ? '$INSTDIR' : '$INSTDIR\\' + folder).replace('$$INSTDIR', '$INSTDIR')}`)
    copy.push(`File ${quote(source)}`)
    remove.push(`Delete ${quote('$INSTDIR\\' + file).replace('$$INSTDIR', '$INSTDIR')}`)
    size += (await stat(source)).size
    for (let parent = folder; parent !== '.'; parent = dirname(parent)) directories.add(parent)
  }
  const removeDirectories = [...directories].sort((a, b) => b.length - a.length)
    .map((folder) => `RMDir ${quote('$INSTDIR\\' + folder).replace('$$INSTDIR', '$INSTDIR')}`)
  await writeFile(join(scratch, 'install-files.nsh'), copy.join('\r\n'), 'utf8')
  await writeFile(join(scratch, 'uninstall-files.nsh'), remove.join('\r\n'), 'utf8')
  await writeFile(join(scratch, 'uninstall-directories.nsh'), removeDirectories.join('\r\n'), 'utf8')
  execFileSync(compiler, [
    '/V3', '/INPUTCHARSET', 'UTF8',
    `/DVERSION=${meta.version}`, `/DPE_VERSION=${meta.version.split('-')[0]}.0`, `/DESTIMATED_SIZE=${Math.ceil(size / 1024)}`,
    `/DPAYLOAD=${payload}`, `/DOUTPUT=${temporary}`, `/DMANIFESTS=${scratch}`,
    resolve('scripts', 'installer.nsi'),
  ], { windowsHide: true, stdio: 'inherit' })
  await rename(temporary, installer)
  console.log(installer)
} finally {
  await rm(temporary, { force: true })
  if (dirname(await realpath(scratch)) === tempRoot) await rm(scratch, { recursive: true, force: true })
}
