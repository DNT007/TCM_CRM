[reflection.assembly]::LoadWithPartialName('Microsoft.SqlServer.SqlWmiManagement') | Out-Null
$wmi = New-Object Microsoft.SqlServer.Management.Smo.Wmi.ManagedComputer
$tcp = $wmi.ServerInstances['MSSQLSERVER'].ServerProtocols['Tcp']
$tcp.IsEnabled = $true
$tcp.Alter()
Write-Host 'TCP/IP enabled. Restarting SQL Server service...'
Restart-Service MSSQLSERVER -Force
Start-Sleep -Seconds 5
Write-Host 'Done - SQL Server restarted'
