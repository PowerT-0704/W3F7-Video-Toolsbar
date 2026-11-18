; -*- coding: utf-8 -*-
Unicode true
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
ManifestDPIAware true

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "x64.nsh"

!define APPLICATION "W3F7-Video-Toolsbar"
!define APP_NAME "W3F7のVideo_Toolsbar"
!define PRODUCT_KEY "Software\W3F7\VideoToolsbar"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\W3F7-Video-Toolsbar"
!define SHORTCUT_FOLDER "W3F7 Video Toolsbar"

Name "${APP_NAME}"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\${APPLICATION}"
InstallDirRegKey HKCU "${PRODUCT_KEY}" "InstallDir"
BrandingText "W3F7"
ShowInstDetails show
ShowUninstDetails show
VIProductVersion "${PE_VERSION}"
VIAddVersionKey /LANG=2052 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "CompanyName" "W3F7"
VIAddVersionKey /LANG=2052 "LegalCopyright" "© 2026 W3F7"
VIAddVersionKey /LANG=2052 "FileDescription" "${APP_NAME} 安装程序"

!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "安装 ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT "将安装 ${APP_NAME} ${VERSION}。$\r$\n$\r$\n安装到当前用户目录，可选择安装位置和桌面快捷方式。$\r$\n$\r$\n封装视频需要外置 FFmpeg 和 FFprobe，配置步骤见 README。"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${PAYLOAD}\LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPLICATION}.exe"
!define MUI_FINISHPAGE_RUN_NOTCHECKED
!define MUI_FINISHPAGE_RUN_TEXT "启动 ${APP_NAME}"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

!macro CheckApplicationFile
  ${If} ${FileExists} "$INSTDIR\${APPLICATION}.exe"
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\${APPLICATION}.exe", i 0x40000000, i 7, p 0, i 3, i 0x80, p 0) p .r0'
    ${If} $0 == -1
      MessageBox MB_OK|MB_ICONSTOP "无法写入应用文件。请关闭该目录中的应用并检查文件权限，然后重试。" /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
    System::Call 'kernel32::CloseHandle(p r0)'
  ${EndIf}
!macroend

Function .onInit
  SetShellVarContext current
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "此安装包需要 64 位 Windows。" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
FunctionEnd

Function CheckDirectory
  ${GetRoot} "$INSTDIR" $0
  ${If} $INSTDIR == "$0\"
  ${OrIf} $INSTDIR == "$WINDIR"
  ${OrIf} $INSTDIR == "$SYSDIR"
    MessageBox MB_OK|MB_ICONSTOP "请选择独立的应用安装文件夹。" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  ${DirState} "$INSTDIR" $0
  ${If} $0 == 1
    ReadINIStr $0 "$INSTDIR\install-info.ini" "Application" "Id"
    ${If} $0 != "${APPLICATION}"
      MessageBox MB_OK|MB_ICONSTOP "请选择空文件夹，或本软件原来的安装目录。" /SD IDOK
      SetErrorLevel 1
      Abort
    ${EndIf}
  ${EndIf}
  !insertmacro CheckApplicationFile
FunctionEnd

Section "应用程序（必选）" MainSection
  SectionIn RO
  Call CheckDirectory
  SetOutPath "$INSTDIR"
  ClearErrors
  SetOverwrite on
  !include "${MANIFESTS}\install-files.nsh"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "应用文件写入失败，请关闭应用并检查安装目录权限，然后重试。" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  WriteINIStr "$INSTDIR\install-info.ini" "Application" "Id" "${APPLICATION}"
  WriteINIStr "$INSTDIR\install-info.ini" "Application" "Version" "${VERSION}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "${PRODUCT_KEY}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "W3F7"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APPLICATION}.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/PowerT-0704/W3F7-Video-Toolsbar"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" ${ESTIMATED_SIZE}
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  CreateDirectory "$SMPROGRAMS\${SHORTCUT_FOLDER}"
  SetOutPath "$INSTDIR"
  CreateShortcut "$SMPROGRAMS\${SHORTCUT_FOLDER}\${SHORTCUT_FOLDER}.lnk" "$INSTDIR\${APPLICATION}.exe"
  CreateShortcut "$SMPROGRAMS\${SHORTCUT_FOLDER}\卸载.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section /o "桌面快捷方式" DesktopShortcut
  CreateShortcut "$DESKTOP\${SHORTCUT_FOLDER}.lnk" "$INSTDIR\${APPLICATION}.exe"
SectionEnd

Function un.onInit
  SetShellVarContext current
  ReadINIStr $0 "$INSTDIR\install-info.ini" "Application" "Id"
  ${If} $0 != "${APPLICATION}"
    MessageBox MB_OK|MB_ICONSTOP "无法确认应用安装目录，请从原安装目录运行卸载程序。" /SD IDOK
    SetErrorLevel 1
    Abort
  ${EndIf}
  !insertmacro CheckApplicationFile
FunctionEnd

Section "Uninstall"
  SetOutPath "$TEMP"
  ClearErrors
  !include "${MANIFESTS}\uninstall-files.nsh"
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "部分应用文件无法删除，请关闭应用并重试卸载。"
    SetErrorLevel 1
    Abort
  ${EndIf}
  !include "${MANIFESTS}\uninstall-directories.nsh"
  ReadRegStr $0 HKCU "${PRODUCT_KEY}" "InstallDir"
  ${If} $0 == $INSTDIR
    Delete "$DESKTOP\${SHORTCUT_FOLDER}.lnk"
    Delete "$SMPROGRAMS\${SHORTCUT_FOLDER}\${SHORTCUT_FOLDER}.lnk"
    Delete "$SMPROGRAMS\${SHORTCUT_FOLDER}\卸载.lnk"
    RMDir "$SMPROGRAMS\${SHORTCUT_FOLDER}"
    DeleteRegKey HKCU "${UNINSTALL_KEY}"
    DeleteRegKey HKCU "${PRODUCT_KEY}"
  ${EndIf}
  Delete "$INSTDIR\install-info.ini"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
