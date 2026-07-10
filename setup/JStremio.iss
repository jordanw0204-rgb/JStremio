#define MyAppName "JStremio"
#define MyAppExeName "JStremio.exe"
#define MyAppExeLocation SourcePath + "..\target\x86_64-pc-windows-msvc\release\" + MyAppExeName
#define MyAppVersion() GetVersionComponents(MyAppExeLocation, Local[0], Local[1], Local[2], Local[3]), Str(Local[0]) + "." + Str(Local[1]) + "." + Str(Local[2])

#define public Dependency_NoExampleSetup
#include "CodeDependencies.iss"

[Setup]
AppId={{B53A66B4-6530-498F-9657-EB5A534AB4A9}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=JStremio contributors
AppCopyright=JStremio contributors and Smart Code OOD
DefaultDirName={localappdata}\Programs\JStremio
DefaultGroupName=JStremio
SetupMutex=JStremioSetupsMutex,Global\JStremioSetupsMutex
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputBaseFilename=JStremioSetup-v{#MyAppVersion}_x64-unsigned
OutputDir=..
Compression=lzma
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
SetupIconFile={#SourcePath}..\images\stremio.ico
UninstallDisplayIcon={app}\{#MyAppExeName},0

[Code]
function InitializeSetup: Boolean;
begin
  Dependency_AddWebView2;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and
     (MsgBox('Remove JStremio reviews, timestamp notes, settings, and WebView2 profile?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES) then
    DelTree(ExpandConstant('{localappdata}\JStremio'), True, True, True);
end;

[Files]
Source: "{#MyAppExeLocation}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\libmpv-2.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\bin\*"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\resources\extensions\*"; DestDir: "{app}\resources\extensions"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourcePath}..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\LICENSE.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\upstream.lock.json"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\JStremio"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\JStremio"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch JStremio"; Flags: nowait postinstall skipifsilent
