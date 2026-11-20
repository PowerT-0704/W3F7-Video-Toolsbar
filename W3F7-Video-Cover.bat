@echo off
setlocal DisableDelayedExpansion
set "W3F7_BATCH=%~f0"
set "W3F7_INPUT_FIRST=%~1"
set "W3F7_INPUT_SECOND=%~2"
set "W3F7_INPUT_EXTRA=%~3"
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -Command "& { $self = $env:W3F7_BATCH; $source = [IO.File]::ReadAllText($self, [Text.Encoding]::UTF8); $marker = ':: W3F7 POWERSHELL PAYLOAD BELOW'; $payload = $source.Substring($source.LastIndexOf($marker) + $marker.Length); $paths = @($env:W3F7_INPUT_FIRST, $env:W3F7_INPUT_SECOND); if ($env:W3F7_INPUT_EXTRA) { $paths += $env:W3F7_INPUT_EXTRA }; & ([scriptblock]::Create($payload)) -InputPaths $paths -OutputDirectory ([IO.Path]::GetDirectoryName($self)) }"
set "W3F7_EXIT_CODE=%ERRORLEVEL%"
if not "%W3F7_NO_PAUSE%"=="1" pause
exit /b %W3F7_EXIT_CODE%
:: W3F7 POWERSHELL PAYLOAD BELOW
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
        if ($EventData.firstFrame) { Write-Host '正在插入封面帧并复制原视频，请稍候…' }
        else { Write-Host '正在复制原始媒体轨并写入封面…' }
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

function Assert-Chapters($SourceMedia, $ResultMedia, [double]$Shift = 0, [double]$Lead = 0) {
    $before = @($SourceMedia.chapters)
    $after = @($ResultMedia.chapters)
    if ($before.Count -and $Lead -gt 0) {
        if ($after.Count -ne $before.Count + 1 -or $after[0].tags.title -ne '封面帧' -or
            [Math]::Abs([double]$after[0].start_time) -gt 0.001) {
            throw '成品的首帧章节与预期不符。'
        }
        $after = @($after | Select-Object -Skip 1)
    }
    if ($before.Count -ne $after.Count) { throw '成品的章节数量与原文件不符。' }
    for ($index = 0; $index -lt $before.Count; $index++) {
        if ($before[$index].tags.title -ne $after[$index].tags.title -or
            [Math]::Abs([double]$before[$index].start_time + $Shift - [double]$after[$index].start_time) -gt 0.001 -or
            [Math]::Abs([double]$before[$index].end_time + $Shift - [double]$after[$index].end_time) -gt 0.001) {
            throw '成品的章节标题或时间与预期不符。'
        }
    }
}

function Publish-File([string]$Temporary, [string]$Directory, [string]$Stem, [string]$Suffix) {
    $sequence = 1
    while ($true) {
        $number = if ($sequence -eq 1) { '' } else { "_$sequence" }
        $destination = Join-Path $Directory ('{0}{1}{2}.mp4' -f $Stem, $Suffix, $number)
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

function Read-OpeningFrames([string]$Video, [int]$Stream) {
    $options = @('-v','error','-select_streams',"$Stream",'-read_intervals','%+#12','-show_frames',
        '-show_entries','frame=key_frame,best_effort_timestamp_time,color_transfer,duration','-of','json',
        '-format_whitelist','mov','-protocol_whitelist','file','-i',$Video)
    return (Invoke-MediaTool $script:ffprobe $options | ConvertFrom-Json).frames
}

function Get-CoverRotation($Track) {
    $matrix = $Track.side_data_list | Where-Object { $null -ne $_.rotation } | Select-Object -First 1
    if (-not $matrix) { return 0 }
    $rotation = [double]$matrix.rotation
    $rows = [regex]::Matches([string]$matrix.displaymatrix, '(?m)^\s*\d+:\s*(-?\d+)\s+(-?\d+)')
    if ($rows.Count -lt 2 -or [Math]::Abs($rotation % 90) -gt 0.01 -or
        ([double]$rows[0].Groups[1].Value * [double]$rows[1].Groups[2].Value -
            [double]$rows[0].Groups[2].Value * [double]$rows[1].Groups[1].Value) -le 0) {
        throw '首帧模式不支持镜像或任意角度的显示标记。请选择「仅内嵌封面」。'
    }
    return [int]$rotation
}

function Get-CoverFrameFilter($Track, [int]$Rotation) {
    $aspect = 1.0
    $sar = '1/1'
    if ($Track.sample_aspect_ratio -match '^([1-9]\d*):([1-9]\d*)$') {
        $aspect = [double]$Matches[1] / [double]$Matches[2]
        $sar = "$($Matches[1])/$($Matches[2])"
    }
    $width = [Math]::Max(2, [Math]::Ceiling($Track.width * $aspect / 2) * 2)
    $height = $Track.height
    if ([Math]::Abs($Rotation) -eq 90) {
        $width, $height = $height, $width
    }
    $span = "$($width):$height"
    $filters = @("scale=$($span):force_original_aspect_ratio=decrease:force_divisible_by=2",
        "pad=$($span):(ow-iw)/2:(oh-ih)/2:color=black")
    # Compose in display orientation, then invert the rotation for the coded frame.
    switch ($Rotation) {
        90 { $filters += 'transpose=clock' }
        -90 { $filters += 'transpose=cclock' }
        { [Math]::Abs($_) -eq 180 } { $filters += 'hflip','vflip' }
    }
    $range = if ($Track.color_range -eq 'pc' -or $Track.pix_fmt -eq 'yuvj420p') { 'pc' } else { 'tv' }
    $filters += "scale=$($Track.width):$($Track.height):out_range=$($range):alphablend=uniform_color", "setsar=$sar"
    # Use the source's color tags, including unspecified ones, rather than JPEG defaults.
    $properties = @('color_primaries','color_transfer','color_space')
    $fields = @('color_primaries','color_trc','colorspace')
    $color = for ($index = 0; $index -lt $fields.Count; $index++) {
        $value = $Track.($properties[$index])
        if (-not $value -or $value -in @('reserved','unspecified')) { $value = 'unknown' }
        $fields[$index] + '=' + $value
    }
    $filters += 'setparams=range=' + $range + ':' + ($color -join ':')
    return ($filters -join ',')
}

function Read-FirstPacketTime([string]$Video, [int]$Stream) {
    $options = @('-v','error','-select_streams',"$Stream",'-read_intervals','%+#1','-show_packets',
        '-show_entries','packet=pts_time','-of','json','-format_whitelist','mov','-protocol_whitelist','file','-i',$Video)
    $packets = @((Invoke-MediaTool $script:ffprobe $options | ConvertFrom-Json).packets)
    if (-not $packets.Count -or $null -eq $packets[0].pts_time) {
        throw ('无法读取音轨 ' + $Stream + ' 的起始时间。请选择「仅内嵌封面」。')
    }
    return [double]$packets[0].pts_time
}

function Write-CoverSegment([string]$Cover, [string]$Segment, $Track, [int]$TimeScale, [long]$FrameTicks, [int]$Rotation) {
    $options = @('-v','error','-nostdin','-n','-xerror','-f','image2','-pattern_type','none',
        '-framerate',("$TimeScale/$FrameTicks"),'-protocol_whitelist','file')
    if ($Rotation) { $options += @('-display_rotation',"$Rotation",'-noautorotate') }
    $options += @('-i',$Cover,'-vf',(Get-CoverFrameFilter $Track $Rotation),'-frames:v','1',
        '-c:v','libx264','-preset','medium','-crf','16','-pix_fmt',$Track.pix_fmt,'-bf','0',
        '-video_track_timescale',"$TimeScale",'-use_stream_ids_as_track_ids','1',
        '-streamid',('0:' + [Convert]::ToInt32($Track.id.Substring(2), 16)))
    $profile = switch ($Track.profile) {
        'Constrained Baseline' { 'baseline' }
        'Baseline' { 'baseline' }
        'Main' { 'main' }
        'High' { 'high' }
    }
    if ($profile) { $options += @('-profile:v',$profile) }
    if ($Track.level -ge 10 -and $Track.level -le 62) { $options += @('-level:v',"$($Track.level)") }
    $null = Invoke-MediaTool $script:ffmpeg ($options + @('-f','mp4',$Segment))
}

function Format-ConcatPath([string]$Path) {
    return "'" + $Path.Replace('\','/').Replace("'", "'\''") + "'"
}

function Escape-FFMetadata([string]$Value) {
    return $Value -replace '([\\=;#])', '\$1' -replace '\r?\n', ('\' + [char]10)
}

function Write-FirstFrameChapters([string]$Path, $Chapters, [double]$Shift, [double]$Lead) {
    # MP4 readers can extend the first chapter to 0. Give the new frame its own
    # chapter so the original first chapter keeps its shifted start time.
    $leadUs = [long][Math]::Round($Lead * 1000000)
    $lines = @(';FFMETADATA1','[CHAPTER]','TIMEBASE=1/1000000','START=0',"END=$leadUs",'title=封面帧')
    foreach ($chapter in $Chapters) {
        $start = [long][Math]::Round(([double]$chapter.start_time + $Shift) * 1000000)
        $end = [long][Math]::Round(([double]$chapter.end_time + $Shift) * 1000000)
        $lines += @('[CHAPTER]','TIMEBASE=1/1000000',"START=$start","END=$end")
        foreach ($tag in $chapter.tags.PSObject.Properties) {
            $lines += (Escape-FFMetadata $tag.Name) + '=' + (Escape-FFMetadata $tag.Value)
        }
    }
    [IO.File]::WriteAllLines($Path, [string[]]$lines, [Text.UTF8Encoding]::new($false))
}

function Assert-FirstFrame([string]$Video, $SourceTrack, $ResultTrack, [double]$Lead, $SourceOpening) {
    $frames = @(Read-OpeningFrames $Video $ResultTrack.index)
    if ($frames.Count -lt 2 -or $frames[0].key_frame -ne 1 -or
        [Math]::Abs([double]$frames[0].best_effort_timestamp_time) -gt 0.000002 -or
        [Math]::Abs([double]$frames[1].best_effort_timestamp_time - $Lead) -gt 0.000002) {
        throw '成品校验失败。未能在 0 秒写入一帧封面关键帧。'
    }
    if ($SourceTrack.nb_frames -match '^[1-9]\d*$' -and
        [long]$ResultTrack.nb_frames -ne ([long]$SourceTrack.nb_frames + 1)) {
        throw '成品校验失败。主视频帧数与预期不符。'
    }
    if ($SourceOpening.Count -gt 1 -and ($frames.Count -lt 3 -or
        [Math]::Abs(([double]$frames[2].best_effort_timestamp_time - [double]$frames[1].best_effort_timestamp_time) -
            ([double]$SourceOpening[1].best_effort_timestamp_time - [double]$SourceOpening[0].best_effort_timestamp_time)) -gt 0.000003)) {
        throw '成品校验失败。原视频开头的帧间时间与预期不符。'
    }
}

function Select-CoverMode {
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host '  W3F7のVideo_Toolsbar  /  视频封面封装' -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host '  作者    W3F7 · PowerT-0704'
    Write-Host '  主页    https://w3f7.cn'
    Write-Host '  GitHub  https://github.com/PowerT-0704'
    Write-Host ''
    Write-Host '  [1] 仅内嵌封面（默认）' -ForegroundColor Cyan
    Write-Host '      保留原音视频编码，生成 原名_cover.mp4'
    Write-Host '  [2] 仅添加至第一帧' -ForegroundColor Cyan
    Write-Host '      在开头插入一帧封面，生成 原名_firstframe.mp4'
    Write-Host '  [3] 内嵌并添加至第一帧' -ForegroundColor Cyan
    Write-Host '      同时写入内嵌图与首帧，生成 原名_cover_firstframe.mp4'
    Write-Host ''
    Write-Host '  选项 2、3 仅编码新增封面帧，播放时会短暂出现。'
    Write-Host '  首帧副本不保留摄影机时码。相册和平台是否取首帧由其决定。'
    Write-Host '  成品保存在 BAT 所在目录，同名会自动编号。'
    Write-Host '------------------------------------------------------------' -ForegroundColor DarkCyan
    while ($true) {
        Write-Host '  请选择 [1/2/3]，直接回车选 1  ' -NoNewline
        $choice = ([string][Console]::ReadLine()).Trim()
        switch ($choice) {
            '' { return 'embedded' }
            '1' { return 'embedded' }
            '2' { return 'first-frame' }
            '3' { return 'both' }
            default { Write-Host '  请输入 1、2 或 3。' -ForegroundColor Yellow }
        }
    }
}

function Get-FirstFramePlan([string]$Video, $Source, $Kept) {
    $videoTracks = @(Get-VideoTracks $Source)
    if ($videoTracks.Count -ne 1) { throw '首帧模式只能处理一条主视频轨。请选择「仅内嵌封面」。' }
    $track = $videoTracks[0]
    $opening = @(Read-OpeningFrames $Video $track.index)
    if (-not $opening.Count) { throw '无法读取源视频的开头帧。' }
    if ($track.color_transfer -in @('smpte2084','arib-std-b67') -or
        ($opening | Where-Object { $_.color_transfer -in @('smpte2084','arib-std-b67') }) -or
        ($track.side_data_list | Where-Object { $_.side_data_type -match 'DOVI|Dolby Vision|HDR' })) {
        throw '首帧模式目前支持 SDR 视频。HDR 文件可选择「仅内嵌封面」。'
    }
    if ($track.codec_name -ne 'h264' -or $track.pix_fmt -notin @('yuv420p','yuvj420p')) {
        throw '首帧模式需要 H.264 8 位 4:2:0 视频来复制原画面。请选择「仅内嵌封面」。'
    }
    if ($track.time_base -notmatch '^1/([1-9]\d{0,6})$' -or [int]$Matches[1] -gt 1000000) {
        throw '暂时无法精确拼接这个视频的时间基。请选择「仅内嵌封面」。'
    }
    $timeScale = [int]$Matches[1]
    if ($track.id -notmatch '^0x[0-9a-fA-F]{1,8}$' -or $opening[0].key_frame -ne 1) {
        throw '首帧模式需要有效的 MP4 主视频轨，并且原视频从关键帧开始。请选择「仅内嵌封面」。'
    }
    $trackId = [Convert]::ToInt32($track.id.Substring(2), 16)
    if ($trackId -le 0) { throw '主视频轨编号超出首帧模式的支持范围。请选择「仅内嵌封面」。' }
    $unsafe = @($Kept | Where-Object { $_.codec_type -notin @('video','audio','subtitle') })
    if ($unsafe.Count) {
        throw ('首帧模式无法安全平移以下轨道：' + ($unsafe.codec_tag_string -join '、') + '。请选择「仅内嵌封面」。')
    }
    $sourceStart = [double]$Source.format.start_time
    if ([Math]::Abs([double]$opening[0].best_effort_timestamp_time - $sourceStart) -gt 0.000002 -or
        ($Source.chapters | Where-Object { [double]$_.start_time -lt ($sourceStart - 0.001) })) {
        throw '源文件的首个画面或章节与媒体起点不同步，无法安全插入首帧。请选择「仅内嵌封面」。'
    }
    if ((Invoke-MediaTool $script:ffmpeg @('-hide_banner','-encoders')) -notmatch '(?m)^\s*V\S*\s+libx264\s') {
        throw '首帧模式需要 FFmpeg 包含 libx264 编码器。请更换 FFmpeg 构建或选择「仅内嵌封面」。'
    }
    if ((Invoke-MediaTool $script:ffmpeg @('-hide_banner','-bsfs')) -notmatch '(?m)^\s*setts\s*$') {
        throw '首帧模式需要 FFmpeg 包含 setts 比特流过滤器。请更换 FFmpeg 构建或选择「仅内嵌封面」。'
    }

    $frameTicks = [long]$opening[0].duration
    if ($opening.Count -gt 1) {
        $frameTicks = [long][Math]::Round(([double]$opening[1].best_effort_timestamp_time - $sourceStart) * $timeScale)
    }
    if ($frameTicks -le 0) { throw '无法确定插入一帧的时长。请选择「仅内嵌封面」。' }
    $lead = $frameTicks / [double]$timeScale
    $leadUs = [long][Math]::Round($lead * 1000000)
    $rotation = Get-CoverRotation $track
    $audioStarts = @{}
    $audioFilters = @()
    $audioIndex = 0
    foreach ($audio in ($Kept | Where-Object codec_type -eq 'audio')) {
        $audioOpening = @(Read-OpeningFrames $Video $audio.index)
        if ($null -eq $audioOpening[0].best_effort_timestamp_time) {
            throw ('无法读取音轨 ' + $audio.index + ' 的首个采样时间。请选择「仅内嵌封面」。')
        }
        $audibleStart = [double]$audioOpening[0].best_effort_timestamp_time - $sourceStart
        $audioStarts[$audio.index] = $audibleStart + $lead
        $packetStart = Read-FirstPacketTime $Video $audio.index
        if ($packetStart -lt ($audibleStart + $sourceStart - 0.000002)) {
            if ([Math]::Abs($audibleStart) -gt 0.000002) {
                throw ('音轨 ' + $audio.index + ' 含无法安全平移的预卷。请选择「仅内嵌封面」。')
            }
            # Keep discarded decoder priming before 0 while shifting the audible packets.
            $ticks = "round($leadUs/1000000/TB)"
            $audioFilters += @("-bsf:a:$audioIndex", "setts=pts='if(lt(PTS,$ticks),PTS-$ticks,PTS)':dts='if(lt(PTS,$ticks),DTS-$ticks,DTS)':duration=DURATION")
        }
        $audioIndex++
    }
    return @{
        track = $track; trackId = $trackId; opening = $opening; rotation = $rotation; timeScale = $timeScale
        frameTicks = $frameTicks; lead = $lead; shift = $lead - $sourceStart; offset = "$leadUs" + 'us'
        audioStarts = $audioStarts; audioFilters = $audioFilters
    }
}

function Export-Cover([string]$Video, [string]$Cover, [string]$Directory, [string]$Mode) {
    if (-not $Mode) { $Mode = 'embedded' }
    if ($Mode -cnotin @('embedded', 'first-frame', 'both')) { throw '请选择有效的封面方式。' }
    $embedded = $Mode -ne 'first-frame'
    $suffix = switch ($Mode) {
        'embedded' { '_cover' }
        'first-frame' { '_firstframe' }
        'both' { '_cover_firstframe' }
    }
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
    $first = if ($Mode -ne 'embedded') { Get-FirstFramePlan $Video $source $kept }
    $duration = (Get-Seconds $source) + $first.lead
    $temporary = Join-Path $Directory ('.w3f7-' + [guid]::NewGuid().ToString('N') + '.partial.mp4')
    $segment = $temporary + '.cover.mp4'
    $concat = $temporary + '.ffconcat'
    $chapterFile = $temporary + '.ffmetadata'
    $videoInput = @('-format_whitelist','mov','-protocol_whitelist','file','-i',$Video)
    $coverInput = @('-f','image2','-pattern_type','none','-protocol_whitelist','file','-i',$Cover)
    $options = @('-v','error','-nostdin','-n','-xerror','-progress','pipe:1','-nostats')
    $metadataInput = '0'
    if ($first) {
        $options += @('-copyts','-start_at_zero','-f','concat','-safe','0','-format_whitelist','concat,mov',
            '-protocol_whitelist','file','-i',$concat) + $coverInput + @('-itsoffset',$first.offset) + $videoInput
        $metadataInput = '2'
    } else { $options += $videoInput + $coverInput }
    $chapterInput = $metadataInput
    if ($first -and @($source.chapters).Count) {
        $options += @('-f','ffmetadata','-protocol_whitelist','file','-i',$chapterFile)
        $chapterInput = '3'
    }
    foreach ($track in $kept) {
        if (-not $first) { $options += @('-map', ('0:' + $track.index)) }
        elseif ($track.codec_type -eq 'video') { $options += @('-map','0:v:0') }
        else { $options += @('-map',('2:' + $track.index)) }
    }
    if ($embedded) { $options += @('-map','1:v:0',"-disposition:v:$coverIndex",'attached_pic') }
    $options += @('-map_metadata',$metadataInput,'-map_chapters',$chapterInput,'-c','copy')
    if ($first) {
        # avc3 carries each segment's H.264 parameter sets. Order the new packet
        # before the source GOP even when the original first decode time is negative.
        $options += @('-tag:v:0','avc3','-bsf:v:0',"setts=pts=PTS:dts='if(eq(N,0),min(PTS,NEXT_DTS-DURATION),DTS)':duration=DURATION",
            '-video_track_timescale',"$($first.timeScale)",'-movie_timescale','1000000','-avoid_negative_ts','disabled',
            '-metadata','timecode=','-metadata:s:v:0','timecode=','-write_tmcd','0') + $first.audioFilters
    } else { $options += @('-write_tmcd',[string][int]($timecodes.Count -gt 0)) }
    $options += @('-movflags','+faststart','-f','mp4',$temporary)

    Send-Event @{ type = 'progress'; percent = 0; firstFrame = [bool]$first }
    try {
        try {
            if ($first) {
                Write-CoverSegment $Cover $segment $first.track $first.timeScale $first.frameTicks $first.rotation
                $list = @('ffconcat version 1.0','stream',"exact_stream_id $($first.trackId)",
                    ('file ' + (Format-ConcatPath $segment)), "duration $($first.offset)", ('file ' + (Format-ConcatPath $Video)))
                [IO.File]::WriteAllLines($concat, [string[]]$list, [Text.UTF8Encoding]::new($false))
                if ($chapterInput -eq '3') { Write-FirstFrameChapters $chapterFile $source.chapters $first.shift $first.lead }
            }
            $null = Invoke-MediaTool $script:ffmpeg $options {
                param($ProgressLine)
                if ($duration -gt 0 -and $ProgressLine -match '^out_time_us=(\d+)$') {
                    $percent = [math]::Min(98, [math]::Round(([double]$Matches[1] / 1000000 / $duration) * 100))
                    if ($percent -gt 0) { Send-Event @{ type = 'progress'; percent = $percent } }
                }
            }
        } catch {
            $dataTags = @($kept | Where-Object codec_type -eq 'data' | ForEach-Object { $_.codec_tag_string })
            $context = if ($dataTags.Count) { "原文件包含数据轨 $($dataTags -join ', ')。" }
            $fallback = if ($first) { '可尝试选择「仅内嵌封面」。' }
            throw ('封装失败。' + $context + $_.Exception.Message + $fallback)
        }
        $result = Read-Video $temporary
        $pictures = @($result.streams | Where-Object { $_.disposition.attached_pic -eq 1 })
        $resultChapterCarrier = Get-ChapterCarrier $result
        $actual = @($result.streams | Where-Object {
            $_.disposition.attached_pic -ne 1 -and $_.codec_tag_string -ne 'tmcd' -and
            ($null -eq $resultChapterCarrier -or $_.index -ne $resultChapterCarrier.index)
        })
        if ($pictures.Count -ne [int]$embedded -or ($embedded -and ($pictures[0].codec_name -ne $image.codec_name -or
            $pictures[0].width -ne $image.width -or $pictures[0].height -ne $image.height)) -or
            $actual.Count -ne $kept.Count -or [Math]::Abs((Get-Seconds $result) - $duration) -gt 0.05) {
            throw '成品校验失败。媒体轨、封面或时长与预期不符。'
        }
        for ($index = 0; $index -lt $kept.Count; $index++) {
            if ($actual[$index].codec_type -ne $kept[$index].codec_type -or $actual[$index].codec_name -ne $kept[$index].codec_name) {
                throw ('成品媒体轨与源视频不符。轨号 ' + $kept[$index].index)
            }
            if ($first -and $kept[$index].codec_type -eq 'audio') {
                $audioOpening = @(Read-OpeningFrames $temporary $actual[$index].index)
                if ($null -eq $audioOpening[0].best_effort_timestamp_time -or
                    [Math]::Abs([double]$audioOpening[0].best_effort_timestamp_time - $first.audioStarts[$kept[$index].index]) -gt 0.0001) {
                    throw ('成品校验失败。未能同步移动音轨 ' + $kept[$index].index + '。')
                }
            }
        }
        if ($first) {
            if ($result.streams | Where-Object codec_tag_string -eq 'tmcd') { throw '成品校验失败。检测到旧时间码轨。' }
            $resultTrack = @(Get-VideoTracks $result)[0]
            if ($resultTrack.width -ne $first.track.width -or $resultTrack.height -ne $first.track.height -or
                (Get-CoverRotation $resultTrack) -ne $first.rotation) {
                throw '成品校验失败。视频尺寸或显示方向与原视频不符。'
            }
            Assert-FirstFrame $temporary $first.track $resultTrack $first.lead $first.opening
        } else { Assert-Timecodes $source $result }
        Assert-Chapters $source $result $first.shift $first.lead
        $path = Publish-File $temporary $Directory ([IO.Path]::GetFileNameWithoutExtension($Video)) $suffix
        Send-Event @{ type = 'result'; path = $path }
    } finally {
        foreach ($file in @($temporary, $segment, $concat, $chapterFile)) {
            if ([IO.File]::Exists($file)) { [IO.File]::Delete($file) }
        }
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
        'export' {
            $mode = if ($Json) { $request.mode } else {
                Assert-Leaf $request.video
                Assert-Leaf $request.cover
                Select-CoverMode
            }
            Export-Cover $request.video $request.cover $OutputDirectory $mode
        }
        default { throw '未知媒体操作。' }
    }
    exit 0
} catch {
    Send-Event @{ type = 'error'; message = $_.Exception.Message }
    exit 1
}
