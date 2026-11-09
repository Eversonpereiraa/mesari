; Etapas extras do instalador do Mesari (o resto vem do electron-builder, em português):
;   Boas-vindas → Termos de uso → Para quem instalar → Pasta → OPÇÕES (esta) → Instalando → Concluído
;
; Página "Opções": checkbox "Criar atalho na Área de Trabalho" (marcado). A escolha fica gravada
; em HKCU\Software\Mesari\AtalhoAreaDeTrabalho para as atualizações silenciosas respeitarem.
;
; Página final: "Abrir o Mesari ao terminar" (marcado) e "Iniciar o Mesari com o Windows". A
; segunda grava a mesma entrada de inicialização que o app usa (HKCU\...\Run, valor "Mesari"),
; então a opção aparece igual dentro do app e pode ser desligada lá.

!include nsDialogs.nsh

Var MesariChkAtalho
Var MesariAtalho

!macro customPageAfterChangeDir
  Page custom MesariOpcoesPage MesariOpcoesLeave
!macroend

Function MesariOpcoesPage
  ${if} ${isUpdated}
    Abort ; atualização: não mostra a página
  ${endif}
  !insertmacro MUI_HEADER_TEXT "Opções de instalação" "Escolha como o Mesari vai aparecer no seu computador."
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 24u "Marque o que deseja. Você pode mudar isso depois, se quiser."
  Pop $0
  ${NSD_CreateCheckbox} 0 32u 100% 12u "Criar atalho na Área de Trabalho"
  Pop $MesariChkAtalho
  ${NSD_Check} $MesariChkAtalho
  ${NSD_CreateLabel} 12u 48u 95% 20u "Um ícone do Mesari na sua tela inicial para abrir o sistema com dois cliques."
  Pop $0
  SetCtlColors $0 "808080" "transparent"
  nsDialogs::Show
FunctionEnd

Function MesariOpcoesLeave
  ${NSD_GetState} $MesariChkAtalho $MesariAtalho
FunctionEnd

!macro customInstall
  ${if} ${isUpdated}
    ; Atualização silenciosa: respeita o que foi escolhido na primeira instalação.
    ReadRegStr $0 HKCU "Software\Mesari" "AtalhoAreaDeTrabalho"
    ${if} $0 == "1"
      CreateShortCut "$DESKTOP\Mesari.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
    ${endif}
    ; $0 vazio = veio da 1.1.x (o atalho era sempre criado): mantém o que existir.
  ${else}
    ${if} $MesariAtalho == ${BST_CHECKED}
      CreateShortCut "$DESKTOP\Mesari.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
      WriteRegStr HKCU "Software\Mesari" "AtalhoAreaDeTrabalho" "1"
    ${else}
      WriteRegStr HKCU "Software\Mesari" "AtalhoAreaDeTrabalho" "0"
    ${endif}
  ${endif}
!macroend

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

  !define MUI_FINISHPAGE_TITLE "Tudo pronto!"
  !define MUI_FINISHPAGE_TEXT "O Mesari foi instalado no seu computador.$\r$\n$\r$\nEntre com o e-mail e a senha da sua conta para começar a usar."
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
    Delete "$DESKTOP\Mesari.lnk"
    DeleteRegValue HKCU "Software\Mesari" "AtalhoAreaDeTrabalho"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Mesari"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.mesari.app"
  ${endif}
!macroend
