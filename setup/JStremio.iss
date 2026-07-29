#define MyAppName "JStremio"
#define MyAppExeName "JStremio.exe"
#define MyAppExeLocation SourcePath + "..\target\x86_64-pc-windows-msvc\release\" + MyAppExeName
#define MyUpdaterExeLocation SourcePath + "..\updater\target\x86_64-pc-windows-msvc\release\JStremioUpdater.exe"
#define MyAppVersion() GetVersionComponents(MyAppExeLocation, Local[0], Local[1], Local[2], Local[3]), Str(Local[0]) + "." + Str(Local[1]) + "." + Str(Local[2])

#define public Dependency_NoExampleSetup
#include "CodeDependencies.iss"

[Setup]
AppId={{B53A66B4-6530-498F-9657-EB5A534AB4A9}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher=JStremio contributors
AppPublisherURL=https://github.com/jordanw0204-rgb/JStremio
AppSupportURL=https://github.com/jordanw0204-rgb/JStremio/issues
AppUpdatesURL=https://github.com/jordanw0204-rgb/JStremio/releases
AppCopyright=JStremio contributors and Smart Code OOD
DefaultDirName={localappdata}\Programs\JStremio
DefaultGroupName=JStremio
SetupMutex=JStremioSetupsMutex,Global\JStremioSetupsMutex
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
DisableWelcomePage=yes
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
OutputBaseFilename=JStremioSetup-v{#MyAppVersion}_x64-unsigned
OutputDir=..\installer
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern dynamic
CloseApplications=force
RestartApplications=no
SetupLogging=yes
SetupIconFile={#SourcePath}..\images\jstremio.ico
WizardImageFile={#SourcePath}..\images\jstremio-installer-sidebar-v2.bmp
WizardSmallImageFile={#SourcePath}..\images\jstremio-installer-header-v2.bmp
UninstallDisplayIcon={app}\{#MyAppExeName},0

[Code]
function InitializeSetup: Boolean;
begin
  Dependency_AddWebView2;
  Result := True;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := PageID = wpSelectTasks;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and
     (MsgBox('Remove JStremio reviews, timestamp notes, settings, and WebView2 profile?', mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES) then
    DelTree(ExpandConstant('{localappdata}\JStremio'), True, True, True);
end;

function IsAutomaticUpdate: Boolean;
begin
  Result := ExpandConstant('{param:JSTREMIOUPDATE|0}') = '1';
end;

[Files]
Source: "{#MyAppExeLocation}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#MyUpdaterExeLocation}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\libmpv-2.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\bin\*"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\resources\extensions\*"; DestDir: "{app}\resources\extensions"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourcePath}..\README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\LICENSE.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}..\upstream.lock.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}installed-channel.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourcePath}default-addons.json"; DestDir: "{app}\setup"; Flags: ignoreversion

; Keep the installed extension tree until its replacement files have been
; copied successfully. Inno Setup processes [InstallDelete] before [Files],
; so deleting this directory here can leave the base Stremio UI behind when
; an upgrade later aborts on a locked native DLL. Remove obsolete extensions
; only through explicit, versioned migration entries.

[Icons]
Name: "{autoprograms}\JStremio"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\JStremio"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch JStremio"; Flags: nowait postinstall skipifsilent
Filename: "{app}\{#MyAppExeName}"; Flags: nowait; Check: IsAutomaticUpdate
