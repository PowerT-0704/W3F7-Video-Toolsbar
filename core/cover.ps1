param([switch]$Json, [string[]]$InputPaths, [string]$OutputDirectory)

$ErrorActionPreference = 'Stop'
if ($Json) { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) }

function Send-Event($EventData) {
    if ($Json) {
        [Console]::WriteLine((ConvertTo-Json -InputObject $EventData -Depth 6 -Compress))
    } elseif ($EventData.type -eq 'error') {
        Write-Host $EventData.message -ForegroundColor Red
    } elseif ($EventData.type -eq 'result') {
        Write-Host ('封装完成：' + $EventData.path) -ForegroundColor Green
    } elseif ($EventData.type -eq 'progress' -and $EventData.percent -eq 0) {
        Write-Host '正在复制原始媒体轨并写入封面…'
    }
}

function Quote-Argument([string]$Value) {
    if ($Value -and $Value -notmatch '[\s"]') { return $Value }
    $escaped = $Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1'
    return '"' + $escaped + '"'
}

function Invoke-MediaTool([string]$Executable, [string[]]$Arguments, [scriptblock]$OnLine) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.Arguments = ($Arguments | ForEach-Object { Quote-Argument $_ }) -join ' '
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = [Text.Encoding]::UTF8
    $start.StandardErrorEncoding = [Text.Encoding]::UTF8
    $process = [Diagnostics.Process]::Start($start)
    try {
        $diagnostics = $process.StandardError.ReadToEndAsync()
        $output = ''
        if ($OnLine) {
            while ($null -ne ($line = $process.StandardOutput.ReadLine())) { & $OnLine $line }
        } else {
            $output = $process.StandardOutput.ReadToEnd()
        }
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            $details = $diagnostics.GetAwaiter().GetResult().Trim()
            if ($details.Length -gt 2500) { $details = $details.Substring($details.Length - 2500) }
            throw ('{0} 退出码 {1}。{2}' -f [IO.Path]::GetFileName($Executable), $process.ExitCode, $details)
        }
        return $output
    } finally {
        if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
        $process.Dispose()
    }
}

function Resolve-Tool([string]$Name, [string]$Directory) {
    if ($Directory) {
        $candidate = Join-Path $Directory ($Name + '.exe')
        if ([IO.File]::Exists($candidate)) { return $candidate }
    } else {
        $candidate = Get-Command ($Name + '.exe') -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($candidate) { return $candidate.Source }
    }
    throw ("找不到 " + $Name + "。请安装 FFmpeg，将 bin 加入 PATH，或在桌面版设置中选择 bin 文件夹。")
}

function Read-Media([string]$File, [string]$Formats) {
    $options = @('-v','error','-show_streams','-show_format','-show_chapters','-of','json','-format_whitelist',$Formats,'-protocol_whitelist','file','-i',$File)
    return (Invoke-MediaTool $script:ffprobe $options | ConvertFrom-Json)
}

function Assert-Leaf([string]$File) {
    if (-not [IO.Path]::IsPathRooted($File) -or -not [IO.File]::Exists($File)) {
        throw ("文件不存在或无法读取：" + $File)
    }
}

function Get-VideoTracks($Media) {
    return $Media.streams | Where-Object { $_.codec_type -eq 'video' -and $_.disposition.attached_pic -ne 1 }
}

function Get-Seconds($Media) {
    $seconds = 0.0
    [void][double]::TryParse([string]$Media.format.duration, [Globalization.NumberStyles]::Float,
        [Globalization.CultureInfo]::InvariantCulture, [ref]$seconds)
    return $seconds
}

function Read-Video([string]$File) {
    Assert-Leaf $File
    if ([IO.Path]::GetExtension($File) -ne '.mp4') { throw '视频格式须为 MP4。' }
    $media = Read-Media $File 'mov'
    if ($media.format.format_name -notmatch '(^|,)mp4(,|$)' -or @(Get-VideoTracks $media).Count -eq 0) {
        throw '该文件没有可封装的 MP4 视频轨。'
    }
    return $media
}

function Confirm-Cover([string]$File) {
    Assert-Leaf $File
    $expected = switch ([IO.Path]::GetExtension($File)) {
        '.png' { 'png' }
        '.jpg' { 'mjpeg' }
        '.jpeg' { 'mjpeg' }
        default { throw '封面格式须为 PNG、JPG 或 JPEG。' }
    }
    $media = Read-Media $File 'png_pipe,jpeg_pipe,image2'
    $track = @($media.streams)[0]
    if ($track.codec_name -ne $expected -or $track.width -le 0 -or $track.height -le 0) {
        throw '封面内容与扩展名不符，或图像已损坏。'
    }
    $null = Invoke-MediaTool $script:ffmpeg @('-v','error','-xerror','-nostdin','-f','image2','-pattern_type','none',
        '-protocol_whitelist','file','-i',$File,'-frames:v','1','-f','null','-')
    return $track
}

function Assert-Timecodes($SourceMedia, $ResultMedia) {
    $original = @($SourceMedia.streams | Where-Object codec_tag_string -eq 'tmcd')
    $result = @($ResultMedia.streams | Where-Object codec_tag_string -eq 'tmcd')
    if ($original.Count -ne $result.Count) { throw '输出的时间码轨数量与原文件不符。' }
    for ($index = 0; $index -lt $original.Count; $index++) {
        if ($original[$index].tags.timecode -ne $result[$index].tags.timecode -or
            [math]::Abs([double]$original[$index].duration - [double]$result[$index].duration) -gt 0.05) {
            throw '输出的时间码与原文件不符。'
        }
    }
}

function Get-ChapterCarrier($Media) {
    $chapters = @($Media.chapters)
    if ($chapters.Count -eq 0) { return }
    $candidates = @($Media.streams | Where-Object {
        $_.codec_type -eq 'data' -and $_.codec_tag_string -eq 'text' -and
        $_.tags.handler_name -eq 'SubtitleHandler' -and [int]$_.nb_frames -eq $chapters.Count
    })
    # FFmpeg creates a chapter carrier when mapping the chapter table.
    if ($candidates.Count -eq 1) { return $candidates[0] }
}

function Assert-Chapters($SourceMedia, $ResultMedia) {
    $before = @($SourceMedia.chapters)
    $after = @($ResultMedia.chapters)
    if ($before.Count -ne $after.Count) { throw '成品的章节数量与原文件不符。' }
    for ($index = 0; $index -lt $before.Count; $index++) {
        if ($before[$index].tags.title -ne $after[$index].tags.title -or
            [Math]::Abs([double]$before[$index].start_time - [double]$after[$index].start_time) -gt 0.001 -or
            [Math]::Abs([double]$before[$index].end_time - [double]$after[$index].end_time) -gt 0.001) {
            throw '成品的章节标题或时间与原文件不符。'
        }
    }
}

function Publish-File([string]$Temporary, [string]$Directory, [string]$Stem) {
    $sequence = 1
    while ($true) {
        $suffix = if ($sequence -eq 1) { '' } else { "_$sequence" }
        $destination = Join-Path $Directory ('{0}_cover{1}.mp4' -f $Stem, $suffix)
        if (-not ([IO.File]::Exists($destination) -or [IO.Directory]::Exists($destination))) {
            try {
                [IO.File]::Move($Temporary, $destination)
                return $destination
            } catch {
                if (-not ([IO.File]::Exists($destination) -or [IO.Directory]::Exists($destination))) { throw }
            }
        }
        $sequence++
    }
}

function Export-Cover([string]$Video, [string]$Cover, [string]$Directory) {
    $source = Read-Video $Video
    $image = Confirm-Cover $Cover
    if (-not $Directory) { $Directory = [IO.Path]::GetDirectoryName($Video) }
    if (-not [IO.Directory]::Exists($Directory)) { throw ('输出文件夹不存在：' + $Directory) }

    $timecodes = @($source.streams | Where-Object codec_tag_string -eq 'tmcd')
    $sourceChapterCarrier = Get-ChapterCarrier $source
    $kept = @($source.streams | Where-Object {
        $_.disposition.attached_pic -ne 1 -and $_.codec_tag_string -ne 'tmcd' -and
        ($null -eq $sourceChapterCarrier -or $_.index -ne $sourceChapterCarrier.index)
    })
    $coverIndex = @($kept | Where-Object codec_type -eq 'video').Count
    $duration = Get-Seconds $source
    $temporary = Join-Path $Directory ('.w3f7-' + [guid]::NewGuid().ToString('N') + '.partial.mp4')
    $options = @('-v','error','-nostdin','-n','-xerror','-progress','pipe:1','-nostats',
        '-format_whitelist','mov','-protocol_whitelist','file','-i',$Video,'-f','image2','-pattern_type','none','-protocol_whitelist','file','-i',$Cover)
    foreach ($track in $kept) { $options += @('-map', ('0:' + $track.index)) }
    $options += @('-map','1:v:0','-map_metadata','0','-map_chapters','0','-c','copy',
        "-disposition:v:$coverIndex",'attached_pic','-write_tmcd',[string][int]($timecodes.Count -gt 0),
        '-movflags','+faststart','-f','mp4',$temporary)

    Send-Event @{ type = 'progress'; percent = 0 }
    try {
        try {
            $null = Invoke-MediaTool $script:ffmpeg $options {
                param($ProgressLine)
                if ($duration -gt 0 -and $ProgressLine -match '^out_time_us=(\d+)$') {
                    $percent = [math]::Min(98, [math]::Round(([double]$Matches[1] / 1000000 / $duration) * 100))
                    Send-Event @{ type = 'progress'; percent = $percent }
                }
            }
        } catch {
            $dataTags = @($kept | Where-Object codec_type -eq 'data' | ForEach-Object { $_.codec_tag_string })
            $context = if ($dataTags.Count) { "原文件包含数据轨 $($dataTags -join ', ')。" } else { '' }
            throw ('封装失败。' + $context + $_.Exception.Message)
        }
        $result = Read-Video $temporary
        $pictures = @($result.streams | Where-Object { $_.disposition.attached_pic -eq 1 })
        $resultChapterCarrier = Get-ChapterCarrier $result
        $actual = @($result.streams | Where-Object {
            $_.disposition.attached_pic -ne 1 -and $_.codec_tag_string -ne 'tmcd' -and
            ($null -eq $resultChapterCarrier -or $_.index -ne $resultChapterCarrier.index)
        })
        if ($pictures.Count -ne 1 -or $pictures[0].codec_name -ne $image.codec_name -or
            $pictures[0].width -ne $image.width -or $pictures[0].height -ne $image.height -or
            $actual.Count -ne $kept.Count -or [Math]::Abs((Get-Seconds $result) - $duration) -gt 0.05) {
            throw '成品校验失败。媒体轨、封面或时长与预期不符。'
        }
        for ($index = 0; $index -lt $kept.Count; $index++) {
            if ($actual[$index].codec_type -ne $kept[$index].codec_type -or $actual[$index].codec_name -ne $kept[$index].codec_name) {
                throw ('成品媒体轨与源视频不符。轨号 ' + $kept[$index].index)
            }
        }
        Assert-Timecodes $source $result
        Assert-Chapters $source $result
        $path = Publish-File $temporary $Directory ([IO.Path]::GetFileNameWithoutExtension($Video))
        Send-Event @{ type = 'result'; path = $path }
    } finally {
        if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
    }
}

try {
    $operation = 'export'
    if ($Json) {
        $request = ConvertFrom-Json $env:W3F7_MEDIA_REQUEST
        $operation = $request.operation
        $OutputDirectory = $request.outputDirectory
    } else {
        if ($InputPaths.Count -ne 2 -or -not $InputPaths[0] -or -not $InputPaths[1]) {
            throw '请同时选择一个 MP4 视频和一张 PNG/JPG/JPEG 封面，拖到本批处理文件上。'
        }
        $videos = @($InputPaths | Where-Object { [IO.Path]::GetExtension($_) -eq '.mp4' })
        $covers = @($InputPaths | Where-Object { [IO.Path]::GetExtension($_) -in @('.png','.jpg','.jpeg') })
        if ($videos.Count -ne 1 -or $covers.Count -ne 1) {
            throw '需要一个 MP4 视频和一张 PNG/JPG/JPEG 封面。'
        }
        $request = @{ video = [IO.Path]::GetFullPath($videos[0]); cover = [IO.Path]::GetFullPath($covers[0]) }
    }
    $script:ffmpeg = Resolve-Tool 'ffmpeg' $request.toolDirectory
    $script:ffprobe = Resolve-Tool 'ffprobe' $request.toolDirectory
    switch ($operation) {
        'detect' {
            $version = ((Invoke-MediaTool $script:ffmpeg @('-version')) -split '\r?\n')[0]
            $probeVersion = ((Invoke-MediaTool $script:ffprobe @('-version')) -split '\r?\n')[0]
            if ($version -notmatch '^ffmpeg version ' -or $probeVersion -notmatch '^ffprobe version ') {
                throw '所选目录中的程序未返回有效的 FFmpeg 和 FFprobe 版本。'
            }
            Send-Event @{ type = 'result'; version = ($version -split ' ')[2]; ffmpeg = $script:ffmpeg; ffprobe = $script:ffprobe }
        }
        'inspect' {
            $media = Read-Video $request.video
            $track = @(Get-VideoTracks $media)[0]
            $startTime = 0.0
            [void][double]::TryParse([string]$media.format.start_time, [Globalization.NumberStyles]::Float,
                [Globalization.CultureInfo]::InvariantCulture, [ref]$startTime)
            $timeBase = 0.000001
            if ($track.time_base -match '^(\d+)/([1-9]\d*)$') { $timeBase = [double]$Matches[1] / [double]$Matches[2] }
            $trackStart = 0.0
            $trackLength = 0.0
            [void][double]::TryParse([string]$track.start_time, [Globalization.NumberStyles]::Float,
                [Globalization.CultureInfo]::InvariantCulture, [ref]$trackStart)
            [void][double]::TryParse([string]$track.duration, [Globalization.NumberStyles]::Float,
                [Globalization.CultureInfo]::InvariantCulture, [ref]$trackLength)
            Send-Event @{ type = 'result'; duration = (Get-Seconds $media); width = $track.width;
                height = $track.height; codec = $track.codec_name; startTime = $startTime; timeBase = $timeBase;
                videoEnd = $(if ($trackLength -gt 0) { $trackStart + $trackLength - $startTime }) }
        }
        'export' { Export-Cover $request.video $request.cover $OutputDirectory }
        default { throw '未知媒体操作。' }
    }
    exit 0
} catch {
    Send-Event @{ type = 'error'; message = $_.Exception.Message }
    exit 1
}
