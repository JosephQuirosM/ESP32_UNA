$ErrorActionPreference = 'Stop'
try {
    $ics = New-Object -ComObject HNetCfg.HNetShare
    $privadas = @()
    foreach ($conexion in $ics.EnumEveryConnection()) {
        $config = $ics.INetSharingConfigurationForINetConnection($conexion)
        if (-not $config.SharingEnabled -or $config.SharingConnectionType -ne 1) { continue }
        $propiedades = $ics.NetConnectionProps($conexion)
        $adaptador = Get-NetAdapter -IncludeHidden | Where-Object {
            "$($_.InterfaceGuid)".Trim('{}') -ieq "$($propiedades.Guid)".Trim('{}') -and $_.Status -eq 'Up'
        }
        if (-not $adaptador) { continue }
        $ips = @(Get-NetIPAddress -InterfaceIndex $adaptador.ifIndex -AddressFamily IPv4 | Where-Object {
            $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '127.0.0.1'
        })
        if ($ips.Count -eq 1) { $privadas += [pscustomobject]@{ interfaz = $adaptador.Name; ip = $ips[0].IPAddress } }
    }
    if ($privadas.Count -eq 1) { $privadas[0] | ConvertTo-Json -Compress } else { 'null' }
} catch { 'null' }
