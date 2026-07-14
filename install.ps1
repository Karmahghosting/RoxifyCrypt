[CmdletBinding()]
param(
    [string] $VencordDir = (Join-Path $HOME "Vencord"),
    [string] $RoxifyLib = "C:\roxify-lib",
    [switch] $SkipInject
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RawBase = "https://raw.githubusercontent.com/Karmahghosting/RoxifyCrypt/main/roxifyCrypt"
$DefaultModulePath = "C:\roxify-lib\node_modules\roxify"

function Write-Step([string] $msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok([string] $msg) { Write-Host "    ok : $msg" -ForegroundColor Green }
function Write-Note([string] $msg) { Write-Host "    !  $msg" -ForegroundColor Yellow }

function Stop-Install([string] $msg) {
    Write-Host "`nInstallation interrompue : $msg" -ForegroundColor Red
    exit 1
}

function Test-Cmd([string] $name) {
    return [bool] (Get-Command $name -ErrorAction SilentlyContinue)
}

function Update-PathFromRegistry {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machine;$user"
}

function Invoke-CmdSoft([string] $file, [string[]] $argList, [string] $workDir) {
    Push-Location $workDir
    try {
        $global:LASTEXITCODE = 0
        & $file @argList | Out-Host
        return ($LASTEXITCODE -eq 0)
    } catch {
        Write-Note $_.Exception.Message
        return $false
    } finally {
        Pop-Location
    }
}

function Invoke-Cmd([string] $file, [string[]] $argList, [string] $workDir) {
    if (-not (Invoke-CmdSoft $file $argList $workDir)) {
        Stop-Install "la commande '$file $($argList -join ' ')' a echoue"
    }
}

Write-Host "RoxifyCrypt : installation automatique" -ForegroundColor Magenta
Write-Host "Vencord   : $VencordDir"
Write-Host "roxify    : $RoxifyLib"

Write-Step "Verification des prerequis"

if (-not (Test-Cmd "git")) { Stop-Install "git est introuvable. Installe-le depuis https://git-scm.com puis relance." }
Write-Ok "git"

if (-not (Test-Cmd "node")) { Stop-Install "Node.js est introuvable. Installe la LTS depuis https://nodejs.org puis relance." }
$nodeMajor = [int] (((& node -v) -replace "^v", "") -split "\.")[0]
if ($nodeMajor -lt 18) { Stop-Install "Node.js $nodeMajor est trop ancien, il faut au moins la version 18." }
Write-Ok "node $(& node -v)"

if (-not (Test-Cmd "pnpm")) {
    Write-Note "pnpm absent, installation globale via npm"
    Invoke-Cmd "npm" @("install", "-g", "pnpm") $HOME
    Update-PathFromRegistry
    if (-not (Test-Cmd "pnpm")) {
        Stop-Install "pnpm vient d'etre installe mais reste introuvable. Ferme et rouvre ton terminal, puis relance ce script."
    }
}
Write-Ok "pnpm $(& pnpm -v)"

Write-Step "Vencord"

if (Test-Path (Join-Path $VencordDir ".git")) {
    Write-Ok "deja present, mise a jour"
    if (-not (Invoke-CmdSoft "git" @("pull", "--ff-only") $VencordDir)) {
        Write-Note "impossible de mettre a jour le depot Vencord, on continue avec la version locale"
    }
} elseif ((Test-Path $VencordDir) -and (Get-ChildItem -Force $VencordDir | Select-Object -First 1)) {
    Stop-Install "$VencordDir existe deja et n'est pas un clone de Vencord. Choisis un autre dossier avec -VencordDir."
} else {
    Invoke-Cmd "git" @("clone", "https://github.com/Vendicated/Vencord", $VencordDir) $HOME
    Write-Ok "clone termine"
}

Write-Step "Dependances de Vencord"
if (-not (Invoke-CmdSoft "pnpm" @("install", "--frozen-lockfile") $VencordDir)) {
    Write-Note "lockfile incompatible avec ta version de pnpm, nouvelle tentative sans --frozen-lockfile"
    Invoke-Cmd "pnpm" @("install") $VencordDir
}
Write-Ok "dependances installees"

Write-Step "Module roxify"

try {
    New-Item -ItemType Directory -Force -Path $RoxifyLib | Out-Null
} catch {
    $RoxifyLib = Join-Path $env:LOCALAPPDATA "roxify-lib"
    New-Item -ItemType Directory -Force -Path $RoxifyLib | Out-Null
    Write-Note "ecriture impossible a l'emplacement demande, repli sur $RoxifyLib"
}

if (-not (Test-Path (Join-Path $RoxifyLib "package.json"))) {
    Invoke-Cmd "npm" @("init", "-y") $RoxifyLib
}
Invoke-Cmd "npm" @("install", "roxify") $RoxifyLib

$modulePath = Join-Path $RoxifyLib "node_modules\roxify"
if (-not (Test-Path (Join-Path $modulePath "package.json"))) {
    Stop-Install "le module roxify n'a pas ete installe dans $modulePath"
}
Write-Ok "roxify installe dans $modulePath"

Write-Step "Plugin RoxifyCrypt"

$dest = Join-Path $VencordDir "src\userplugins\roxifyCrypt"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$localSource = if ($PSScriptRoot) { Join-Path $PSScriptRoot "roxifyCrypt" } else { $null }

if ($localSource -and (Test-Path (Join-Path $localSource "index.tsx"))) {
    Copy-Item -Path (Join-Path $localSource "*") -Destination $dest -Recurse -Force
    Write-Ok "copie depuis $localSource"
} else {
    foreach ($file in @("index.tsx", "native.ts", "README.md")) {
        Invoke-WebRequest -Uri "$RawBase/$file" -OutFile (Join-Path $dest $file) -UseBasicParsing
    }
    Write-Ok "telecharge depuis GitHub"
}

if (-not (Test-Path (Join-Path $dest "index.tsx"))) {
    Stop-Install "le plugin n'a pas ete copie dans $dest"
}

Write-Step "Compilation de Vencord"
Invoke-Cmd "pnpm" @("build") $VencordDir
Write-Ok "build termine"

if ($SkipInject) {
    Write-Note "injection ignoree (-SkipInject). Lance 'pnpm inject' dans $VencordDir quand tu veux."
} else {
    Write-Step "Injection dans Discord"
    Write-Host "    Choisis ton Discord (Stable / Canary) dans le menu qui s'ouvre."
    Invoke-Cmd "pnpm" @("inject") $VencordDir
    Write-Ok "injection terminee"
}

Write-Host "`nTermine." -ForegroundColor Magenta
Write-Host "1. Ferme completement Discord (barre des taches comprise) puis rouvre-le."
Write-Host "2. Parametres > Vencord > Plugins > RoxifyCrypt : active-le."

if ($modulePath -ne $DefaultModulePath) {
    Write-Host "3. Dans les reglages du plugin, mets roxifyPath sur :" -ForegroundColor Yellow
    Write-Host "   $modulePath" -ForegroundColor Yellow
} else {
    Write-Host "3. Rien a configurer, roxifyPath pointe deja sur le bon dossier."
}
