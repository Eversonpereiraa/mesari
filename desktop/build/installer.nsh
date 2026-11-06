; Página final do instalador do Mesari: "Abrir o Mesari ao terminar" (marcado) e
; "Iniciar o Mesari com o Windows" (desmarcado). A segunda grava a mesma entrada de
; inicialização que o app usa (HKCU\...\Run, valor "Mesari"), então a opção aparece igual
; dentro do app e pode ser desligada lá.

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function MesariAutoStart
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Mesari" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Abrir o Mesari ao terminar"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Iniciar o Mesari com o Windows"
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "MesariAutoStart"
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Mesari"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.mesari.app"
  ${endif}
!macroend
