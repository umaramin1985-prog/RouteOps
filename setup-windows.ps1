Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  RouteOps - Windows Setup" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

function Check-Command {
    param (
        [string]$Command
    )
    return (Get-Command $Command -ErrorAction SilentlyContinue) -ne $null
}

# Python check
if (Check-Command "python") {
    $py_ver = python --version
    Write-Host "[+] Python is already installed. Version: $py_ver" -ForegroundColor Green
} else {
    Write-Host "[*] Installing Python 3..." -ForegroundColor Yellow
    winget install --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements
}

# Node.js check
if (Check-Command "node") {
    $node_ver = node -v
    Write-Host "[+] Node.js is already installed. Version: $node_ver" -ForegroundColor Green
} else {
    Write-Host "[*] Installing Node.js..." -ForegroundColor Yellow
    winget install --id OpenJS.NodeJS --accept-package-agreements --accept-source-agreements
}

# Docker check
if (Check-Command "docker") {
    $docker_ver = docker --version
    Write-Host "[+] Docker is already installed. Version: $docker_ver" -ForegroundColor Green
    Write-Host "`n"
    $choice = Read-Host "Do you want to (1) Continue Fresh Install or (2) Update Existing Deployment? [1/2]"
    if ($choice -eq '2') {
        Write-Host "[*] Updating production deployment..." -ForegroundColor Yellow
        git pull origin main
        if ($LASTEXITCODE -ne 0) { Write-Host "[-] git pull failed!" -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }

        docker compose -f docker-compose.prod.yml up -d --build
        if ($LASTEXITCODE -ne 0) { Write-Host "[-] docker compose failed!" -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }
        
        docker image prune -f
        Write-Host "[+] Deployment updated successfully." -ForegroundColor Green
        Read-Host "Press Enter to exit"
        exit 0
    } elseif ($choice -eq '1') {
        Write-Host "[*] Tearing down existing deployment to start fresh..." -ForegroundColor Yellow
        docker compose down 2>$null
        docker compose -f docker-compose.prod.yml down 2>$null
        Write-Host "[*] Cleaning up data folder..." -ForegroundColor Yellow
        Remove-Item -Path "data\*" -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "[*] Installing Docker Desktop..." -ForegroundColor Yellow
    winget install --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
    Write-Host "[!] Docker Desktop has been installed but requires you to restart your PC and launch the Docker app once before continuing." -ForegroundColor Red
}

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Installation checks complete!" -ForegroundColor Cyan
Write-Host "  Launching main installation script..." -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

python install.py

Write-Host "`n"
Read-Host -Prompt "Press Enter to exit"
