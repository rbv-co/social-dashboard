# TESTAR O LEITOR NFC — Vessel / Selo de Autenticidade
# 31/08/2026
#
# O QUE ELE FAZ: pergunta ao Windows quais leitores de cartao existem e, se
# houver uma etiqueta encostada, pergunta ao leitor a versao do firmware dele
# e o numero de serie da etiqueta.
#
# ELE NAO GRAVA NADA. So le. Pode rodar com qualquer etiqueta.
#
# COMO RODAR: abra o PowerShell, va ate a pasta onde salvou este arquivo e rode:
#     powershell -ExecutionPolicy Bypass -File .\testar-leitor-nfc_2026-09-01_v2.ps1

# O `if` evita o erro "tipo já existe" quando se roda duas vezes na mesma janela.
if (-not ("Cartao" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Cartao {
  [DllImport("winscard.dll")] public static extern int SCardEstablishContext(int dwScope, IntPtr r1, IntPtr r2, out IntPtr ctx);
  [DllImport("winscard.dll", CharSet=CharSet.Ansi)] public static extern int SCardListReaders(IntPtr ctx, byte[] groups, byte[] readers, ref int len);
  [DllImport("winscard.dll", CharSet=CharSet.Ansi)] public static extern int SCardConnect(IntPtr ctx, string reader, int share, int protocols, out IntPtr card, out int active);
  [DllImport("winscard.dll")] public static extern int SCardTransmit(IntPtr card, ref Pci pioSend, byte[] send, int sendLen, IntPtr pioRecv, byte[] recv, ref int recvLen);
  [DllImport("winscard.dll")] public static extern int SCardDisconnect(IntPtr card, int disposition);
  [StructLayout(LayoutKind.Sequential)] public struct Pci { public int Protocol; public int Length; }
}
"@
}

function Hex($bytes, $n) { ($bytes[0..($n-1)] | ForEach-Object { $_.ToString("X2") }) -join ' ' }

Write-Host ""
Write-Host "=== TESTE DO LEITOR NFC ===" -ForegroundColor Cyan
Write-Host ""

$ctx = [IntPtr]::Zero
if ([Cartao]::SCardEstablishContext(2, [IntPtr]::Zero, [IntPtr]::Zero, [ref]$ctx) -ne 0) {
  Write-Host "FALHOU: o servico de Cartao Inteligente do Windows nao respondeu." -ForegroundColor Red
  Write-Host "Abra os Servicos do Windows e verifique se 'Cartao Inteligente' esta em execucao."
  exit 1
}

$tam = 0
[void][Cartao]::SCardListReaders($ctx, $null, $null, [ref]$tam)
if ($tam -le 0) {
  Write-Host "NENHUM LEITOR ENCONTRADO." -ForegroundColor Red
  Write-Host "Verifique se o ACR122U esta ligado na USB. Tente outra porta."
  exit 1
}
$buf = New-Object byte[] $tam
[void][Cartao]::SCardListReaders($ctx, $null, $buf, [ref]$tam)
$leitores = [System.Text.Encoding]::ASCII.GetString($buf, 0, $tam).Split([char]0) | Where-Object { $_ }

Write-Host "1) COMO O WINDOWS ENXERGA O LEITOR" -ForegroundColor Yellow
foreach ($l in $leitores) { Write-Host "   $l" }
Write-Host ""
Write-Host "   Aparelho de fabrica aparece como:  ACS ACR122U PICC Interface"
Write-Host "   Suspeito de copia aparece como:    RFCARD RF1258V603 PICC Interface"
Write-Host ""

$leitor = $leitores[0]
$card = [IntPtr]::Zero; $ativo = 0
Write-Host "2) ENCOSTE UMA ETIQUETA NO LEITOR e aguarde..." -ForegroundColor Yellow
$conectado = $false
for ($i = 0; $i -lt 30; $i++) {
  if ([Cartao]::SCardConnect($ctx, $leitor, 2, 3, [ref]$card, [ref]$ativo) -eq 0) { $conectado = $true; break }
  Start-Sleep -Milliseconds 500
}
if (-not $conectado) {
  Write-Host "   Nenhuma etiqueta encostada em 15 segundos." -ForegroundColor Red
  Write-Host "   O teste 1 acima ja vale. Rode de novo com a etiqueta encostada."
  exit 0
}
Write-Host "   Etiqueta detectada." -ForegroundColor Green
Write-Host ""

# `[Cartao+Pci]::new()` e nao `New-Object Cartao+Pci`: o `+` do tipo aninhado
# confunde o New-Object em algumas versoes do PowerShell.
$pci = [Cartao+Pci]::new(); $pci.Protocol = $ativo; $pci.Length = 8

function Perguntar($nome, $apdu, $explica) {
  $recv = New-Object byte[] 258; $n = 258
  $r = [Cartao]::SCardTransmit($card, [ref]$pci, $apdu, $apdu.Length, [IntPtr]::Zero, $recv, [ref]$n)
  Write-Host "   $nome" -ForegroundColor Yellow
  if ($r -ne 0 -or $n -le 0) { Write-Host "      (sem resposta)" -ForegroundColor Red; return }
  $hex = Hex $recv $n
  $txt = -join ($recv[0..($n-1)] | ForEach-Object { if ($_ -ge 32 -and $_ -lt 127) { [char]$_ } else { '.' } })
  Write-Host "      bytes: $hex"
  Write-Host "      texto: $txt"
  Write-Host "      $explica"
  Write-Host ""
}

Write-Host "3) O QUE O LEITOR E A ETIQUETA RESPONDEM" -ForegroundColor Yellow
Write-Host ""
Perguntar "Versao do firmware do leitor" ([byte[]]@(0xFF,0x00,0x48,0x00,0x00)) "Conhecidas boas: ACR122U101, 102, 201, 203."
Perguntar "Numero de serie da etiqueta"  ([byte[]]@(0xFF,0xCA,0x00,0x00,0x00)) "7 bytes + 90 00 no fim = leitura OK."
Perguntar "Pagina 3 da etiqueta"          ([byte[]]@(0xFF,0xB0,0x00,0x03,0x04)) "NTAG213 de fabrica responde E1 10 12 00."

[void][Cartao]::SCardDisconnect($card, 0)
Write-Host "=== FIM. Copie tudo acima e mande para o Claude. ===" -ForegroundColor Cyan
