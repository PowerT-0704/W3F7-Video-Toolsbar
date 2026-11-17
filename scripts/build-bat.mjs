import { readFileSync, writeFileSync } from 'node:fs'

const core = readFileSync(new URL('../core/cover.ps1', import.meta.url), 'utf8').replace(/^\uFEFF/, '')
const marker = ':: W3F7 POWERSHELL PAYLOAD BELOW'
const launcher = [
  '@echo off',
  'setlocal DisableDelayedExpansion',
  'set "W3F7_BATCH=%~f0"',
  'set "W3F7_INPUT_FIRST=%~1"',
  'set "W3F7_INPUT_SECOND=%~2"',
  'set "W3F7_INPUT_EXTRA=%~3"',
  '"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -NonInteractive -Command "& { $self = $env:W3F7_BATCH; $source = [IO.File]::ReadAllText($self, [Text.Encoding]::UTF8); $marker = ' + "'" + marker + "'" + '; $payload = $source.Substring($source.LastIndexOf($marker) + $marker.Length); $paths = @($env:W3F7_INPUT_FIRST, $env:W3F7_INPUT_SECOND); if ($env:W3F7_INPUT_EXTRA) { $paths += $env:W3F7_INPUT_EXTRA }; & ([scriptblock]::Create($payload)) -InputPaths $paths -OutputDirectory ([IO.Path]::GetDirectoryName($self)) }"',
  'set "W3F7_EXIT_CODE=%ERRORLEVEL%"',
  'if not "%W3F7_NO_PAUSE%"=="1" pause',
  'exit /b %W3F7_EXIT_CODE%',
  marker,
].join('\n')

writeFileSync(new URL('../W3F7-Video-Cover.bat', import.meta.url),
  (launcher + '\n' + core).replace(/\r?\n/g, '\r\n'), 'utf8')
