import { mkdir, readFile, writeFile } from 'node:fs/promises'
import ts from 'typescript'

await mkdir('dist-electron', { recursive: true })
for (const filename of ['main.ts', 'preload.ts', 'frames.cts', 'media-cache.cts', 'updates.cts']) {
  const source = await readFile('electron/' + filename, 'utf8')
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  })
  await writeFile('dist-electron/' + filename.replace(/\.c?ts$/, '.cjs'), result.outputText)
}
