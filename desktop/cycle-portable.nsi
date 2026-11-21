!define APP_NAME "Cycle.exe"
!define RUNTIME_DIR "$LOCALAPPDATA\CycleExe\app-1.0.2"
!define STAMP_FILE "${RUNTIME_DIR}\.ready"

Name "${APP_NAME}"
Caption "Starting Cycle.exe..."
OutFile "/app/applet/public/downloads/cycle.exe"
Icon "/app/applet/desktop/assets/icon.ico"

RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
AutoCloseWindow true
ShowInstDetails nevershow
XPStyle on

VIProductVersion "1.0.2.0"
VIAddVersionKey "ProductName" "Cycle.exe"
VIAddVersionKey "CompanyName" "Cycle.exe"
VIAddVersionKey "FileDescription" "Cycle.exe Desktop Software"
VIAddVersionKey "FileVersion" "1.0.2.0"
VIAddVersionKey "ProductVersion" "1.0.2.0"
VIAddVersionKey "InternalName" "cycle.exe"
VIAddVersionKey "OriginalFilename" "cycle.exe"
VIAddVersionKey "LegalCopyright" "Cycle.exe 2026"

Page instfiles

Function .onInit
  IfFileExists "${STAMP_FILE}" 0 first_run
  IfFileExists "${RUNTIME_DIR}\cycle.exe" 0 first_run
  IfFileExists "${RUNTIME_DIR}\resources\app.asar" 0 first_run
    Exec '"${RUNTIME_DIR}\cycle.exe"'
    Abort
  first_run:
FunctionEnd

Section "Extract and Launch Cycle.exe"
  SetOutPath "${RUNTIME_DIR}"
  File /r "/tmp/cycle-win-unpacked\*.*"
  FileOpen $0 "${STAMP_FILE}" w
  FileWrite $0 "ok"
  FileClose $0
  Exec '"${RUNTIME_DIR}\cycle.exe"'
SectionEnd
