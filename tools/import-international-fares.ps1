param(
  [Parameter(Mandatory = $true)][string]$WorkbookPath,
  [string]$OutputPath
)

if ([string]::IsNullOrWhiteSpace($OutputPath)) { $OutputPath = Join-Path $PSScriptRoot '..\international-fares.js' }

Add-Type -AssemblyName System.IO.Compression.FileSystem

$companyNames = @{
  AA='American Airlines'; AC='Air Canada'; AM='Aeromexico'; AR='Aerolíneas Argentinas'
  AT='Royal Air Maroc'; AV='Avianca'; AFKLM='Air France / KLM'; AZ='ITA Airways'
  BA='British Airways'; CA='Air China'; CM='Copa Airlines'; DL='Delta Air Lines'
  EK='Emirates'; ET='Ethiopian Airlines'; G3='GOL'; H2='SKY Airline'
  IB='Iberia'; JA='JetSMART'; JL='Japan Airlines'; LA='LATAM Airlines'
  LHLX='Lufthansa / SWISS'; QR='Qatar Airways'; SA='South African Airways'
  TK='Turkish Airlines'; TP='TAP Air Portugal'; UA='United Airlines'; UX='Air Europa'
}

function Get-ColumnNumber([string]$reference) {
  $letters = ([regex]::Match($reference, '^[A-Z]+')).Value
  $number = 0
  foreach ($character in $letters.ToCharArray()) { $number = ($number * 26) + ([int]$character - 64) }
  return $number
}

function Get-ColumnLetters([int]$number) {
  $letters = ''
  while ($number -gt 0) {
    $number--
    $letters = [char](65 + ($number % 26)) + $letters
    $number = [math]::Floor($number / 26)
  }
  return $letters
}

function Clean-Text([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return '' }
  return (($value -replace "`r`n|`r|`n", ' / ') -replace '\s+', ' ').Trim()
}

function Get-FieldKey([string]$label) {
  $normalized = (Clean-Text $label).ToUpperInvariant().Normalize([Text.NormalizationForm]::FormD)
  $normalized = -join ($normalized.ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne [Globalization.UnicodeCategory]::NonSpacingMark })
  if ($normalized -match '^ASSENTO') { return 'seat' }
  if ($normalized -match '^BAGAGEM DE MAO') { return 'carryOn' }
  if ($normalized -match '^BAGAGEM DESPACHADA') { return 'checked' }
  if ($normalized -match 'MULTA DE ALTERACAO') { return 'change' }
  if ($normalized -match '^REEMBOLSO') { return 'refund' }
  if ($normalized -match 'NO[ -]?SHOW') { return 'noShow' }
  if ($normalized -match 'DEIXAR.*ABERTO|DEIXAR.*BERTO|DEIXAR.*MABERTO') { return 'openTicket' }
  return $null
}

$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $WorkbookPath))
try {
  function Read-ZipText([string]$name) {
    $entry = $zip.GetEntry($name)
    if (!$entry) { return $null }
    $reader = [IO.StreamReader]::new($entry.Open())
    try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
  }

  [xml]$sharedXml = Read-ZipText 'xl/sharedStrings.xml'
  $sharedStrings = @()
  foreach ($item in $sharedXml.sst.si) {
    $sharedStrings += (@($item.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '')
  }

  [xml]$workbook = Read-ZipText 'xl/workbook.xml'
  $sheets = @($workbook.workbook.sheets.sheet)
  $companies = @()

  for ($sheetIndex = 0; $sheetIndex -lt $sheets.Count; $sheetIndex++) {
    $sheetCode = [string]$sheets[$sheetIndex].name
    if (!$companyNames.ContainsKey($sheetCode)) { continue }

    [xml]$sheetXml = Read-ZipText ("xl/worksheets/sheet{0}.xml" -f ($sheetIndex + 1))
    $cells = @{}
    foreach ($cell in @($sheetXml.worksheet.sheetData.row.c)) {
      $value = ''
      if ($cell.t -eq 's' -and $null -ne $cell.v) { $value = $sharedStrings[[int]$cell.v] }
      elseif ($cell.t -eq 'inlineStr') { $value = @($cell.is.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join '' }
      elseif ($null -ne $cell.v) { $value = [string]$cell.v }
      $cells[[string]$cell.r] = Clean-Text $value
    }

    $header = @($cells.Values | Where-Object { $_ -match '\d{3}\s*-\s*[A-Z0-9]{2}' } | Select-Object -First 1)
    $profileHeaders = @()
    foreach ($entry in $cells.GetEnumerator()) {
      if ($entry.Value -notmatch '(?i)PERFIL\s*:?' -or $entry.Value -match '(?i)PERFIL\s*:\s*$') { continue }
      $match = [regex]::Match($entry.Value, '(?i)PERFIL\s*:?\s*(.+)$')
      if (!$match.Success -or [string]::IsNullOrWhiteSpace($match.Groups[1].Value)) { continue }
      $profileHeaders += [pscustomobject]@{
        Reference = $entry.Key
        Column = Get-ColumnNumber $entry.Key
        Row = [int]([regex]::Match($entry.Key, '\d+$')).Value
        Name = Clean-Text $match.Groups[1].Value
      }
    }

    $profiles = @()
    foreach ($profileHeader in ($profileHeaders | Sort-Object Row, Column)) {
      $nextRow = @($profileHeaders | Where-Object { $_.Column -eq $profileHeader.Column -and $_.Row -gt $profileHeader.Row } | Sort-Object Row | Select-Object -First 1).Row
      if (!$nextRow) { $nextRow = 1000 }
      $labelColumn = Get-ColumnLetters $profileHeader.Column
      $valueColumn = Get-ColumnLetters ($profileHeader.Column + 2)
      $fields = [ordered]@{}
      $currentField = $null

      for ($row = $profileHeader.Row + 1; $row -lt $nextRow; $row++) {
        $label = $cells["$labelColumn$row"]
        $value = $cells["$valueColumn$row"]
        $fieldKey = Get-FieldKey $label
        if ($fieldKey) { $currentField = $fieldKey }
        if ($currentField -and ![string]::IsNullOrWhiteSpace($value)) {
          if ($fields.Contains($currentField)) { $fields[$currentField] = "$($fields[$currentField]) / $value" }
          else { $fields[$currentField] = $value }
        }
      }

      if ($fields.Count -gt 0) {
        $profiles += [ordered]@{ name=$profileHeader.Name; fields=$fields }
      }
    }

    if ($profiles.Count -gt 0) {
      $companies += [ordered]@{
        code=$sheetCode
        name=$companyNames[$sheetCode]
        reference=if ($header.Count) { Clean-Text ([string]$header[0]) } else { $sheetCode }
        profiles=$profiles
      }
    }
  }

  $json = $companies | ConvertTo-Json -Depth 8 -Compress
  $javascript = "const INTERNATIONAL_FARES=$json;`n"
  [IO.File]::WriteAllText((Join-Path (Resolve-Path (Split-Path $OutputPath -Parent)) (Split-Path $OutputPath -Leaf)), $javascript, [Text.UTF8Encoding]::new($false))
  Write-Output ("Gerado: {0} companhias, {1} perfis" -f $companies.Count, (@($companies | ForEach-Object { $_.profiles.Count }) | Measure-Object -Sum).Sum)
}
finally {
  $zip.Dispose()
}
