!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "WinMessages.nsh"

!ifndef BUILD_UNINSTALLER
  Var isNoDesktopShortcut
  Var DesktopShortcutCheckbox

  !macro isNoDesktopShortcut _t _f
    StrCmp $isNoDesktopShortcut "1" ${_t} ${_f}
  !macroend

  !macro customPageAfterChangeDir
    Page Custom DesktopShortcutPageCreate DesktopShortcutPageLeave
  !macroend

  Function DesktopShortcutPageCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${If} $isNoDesktopShortcut == ""
      StrCpy $isNoDesktopShortcut "0"
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 12u "Additional Options"
    Pop $0

    ${NSD_CreateCheckbox} 0 20u 100% 12u "Create Desktop Shortcut"
    Pop $DesktopShortcutCheckbox
    ${If} $isNoDesktopShortcut == "1"
      ${NSD_Uncheck} $DesktopShortcutCheckbox
    ${Else}
      ${NSD_Check} $DesktopShortcutCheckbox
    ${EndIf}

    nsDialogs::Show
  FunctionEnd

  Function DesktopShortcutPageLeave
    ${NSD_GetState} $DesktopShortcutCheckbox $0
    ${If} $0 == ${BST_CHECKED}
      StrCpy $isNoDesktopShortcut "0"
    ${Else}
      StrCpy $isNoDesktopShortcut "1"
    ${EndIf}
  FunctionEnd
!endif
