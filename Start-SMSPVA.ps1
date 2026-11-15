param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'

function Find-SmsPvaNode {
    $candidates = @(
        (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            try {
                $version = (& $candidate -p 'process.versions.node' 2>$null)
                if ($LASTEXITCODE -eq 0 -and $version -and ([int]($version.Split('.')[0]) -ge 22)) {
                    return $candidate
                }
            } catch { }
        }
    }
    throw 'Falta Node.js 22 o posterior. Instala Node.js >=22 desde https://nodejs.org/.'
}

try {
    $nodePath = Find-SmsPvaNode
    if ($CheckOnly) {
        $nodeVersion = (& $nodePath -p 'process.versions.node' 2>$null)
        Write-Host "Node.js $nodeVersion listo."
        exit 0
    }

    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if (-not $npmCmd) {
        $siblingNpm = Join-Path (Split-Path $nodePath -Parent) 'npm.cmd'
        if (Test-Path -LiteralPath $siblingNpm) {
            $npmCmd = $siblingNpm
        }
    }
    if (-not $npmCmd) {
        throw 'No se encontró npm.cmd junto a Node.js ni en PATH.'
    }

    Push-Location $PSScriptRoot
    try {
        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules'))) {
            Write-Host 'Instalando dependencias (npm.cmd install)...'
            & $npmCmd install
            if ($LASTEXITCODE -ne 0) { throw "npm.cmd install falló (código $LASTEXITCODE)." }
        }

        if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'ui-dist'))) {
            Write-Host 'Compilando interfaz (npm.cmd run build:ui)...'
            & $npmCmd run build:ui
            if ($LASTEXITCODE -ne 0) { throw "npm.cmd run build:ui falló (código $LASTEXITCODE)." }
        }

        $serverScript = Join-Path $PSScriptRoot 'server\server.js'
        Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like "*$serverScript*" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

        & $nodePath $serverScript
        if ($LASTEXITCODE -ne 0) { throw "SMSPVA terminó con error (código $LASTEXITCODE)." }
    } finally {
        Pop-Location
    }
} catch {
    Write-Error $_
    exit 1
}
