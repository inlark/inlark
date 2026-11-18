# Additions to electron-builder's NSIS installer. https://www.electron.build/docs/nsis/

# Opens a short survey in the browser after someone chooses to uninstall inlark.
#
# The uninstaller also runs without anyone asking: updates and reinstalls run the old one with
# /S --updated, and tools such as winget pass /S. Those runs skip the survey. ${Silent} can't make
# that distinction here, because the one-click uninstaller turns silent right after its "Are you
# sure?" prompt. So this checks for /S the same way that prompt does.
#
# inlark installs per user, so when Windows Settings or the Start menu runs the uninstaller, it runs
# as that person without elevation and the browser opens as them too. StdUtils.ExecShellAsUser
# would drop elevation when the uninstaller is started from an admin prompt, but it can't open URLs.
#
# Windows runs the uninstaller of the installed release, so changes here reach people one release
# later.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    Push $R0
    Push $R1
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/S" $R1
    ${if} ${Errors}
      # inlark.com redirects to the survey, so it can move without a new uninstaller.
      ExecShell "open" "https://inlark.com/uninstall?version=${VERSION}"
    ${endIf}
    Pop $R1
    Pop $R0
  ${endIf}
!macroend
