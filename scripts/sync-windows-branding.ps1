$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Xml.Linq

$workspaceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$tokensPath = Join-Path $workspaceRoot 'packages\ui\src\styles\tokens.css'
$iconTemplatePath = Join-Path $workspaceRoot 'apps\desktop\src-tauri\app-icon.template.svg'
$resolvedIconPath = Join-Path $workspaceRoot 'apps\desktop\src-tauri\app-icon.svg'
$windowsIconPath = Join-Path $workspaceRoot 'apps\desktop\src-tauri\icons\icon.ico'
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)

function Convert-LinearToSrgb([double]$channel) {
  if ($channel -le 0.0031308) { return 12.92 * $channel }
  return 1.055 * [Math]::Pow($channel, 1 / 2.4) - 0.055
}

function Convert-OklchToHex([double]$lightness, [double]$chroma, [double]$hue) {
  $radians = $hue * [Math]::PI / 180
  $a = $chroma * [Math]::Cos($radians)
  $b = $chroma * [Math]::Sin($radians)
  $l = [Math]::Pow($lightness + 0.3963377774 * $a + 0.2158037573 * $b, 3)
  $m = [Math]::Pow($lightness - 0.1055613458 * $a - 0.0638541728 * $b, 3)
  $s = [Math]::Pow($lightness - 0.0894841775 * $a - 1.291485548 * $b, 3)
  $red = Convert-LinearToSrgb (4.0767416621 * $l - 3.3077115913 * $m + 0.2309699292 * $s)
  $green = Convert-LinearToSrgb (-1.2684380046 * $l + 2.6097574011 * $m - 0.3413193965 * $s)
  $blue = Convert-LinearToSrgb (-0.0041960863 * $l - 0.7034186147 * $m + 1.707614701 * $s)
  $channels = @($red, $green, $blue) | ForEach-Object {
    $channel = [double]$_
    [int][Math]::Round([Math]::Min(1.0, [Math]::Max(0.0, $channel)) * 255)
  }
  return '#{0:x2}{1:x2}{2:x2}' -f $channels[0], $channels[1], $channels[2]
}

$tokens = [System.IO.File]::ReadAllText($tokensPath, [System.Text.Encoding]::UTF8)
$accentMatches = [regex]::Matches($tokens, '(?m)^\s*--color-accent:\s*oklch\(\s*(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s*\);')
if ($accentMatches.Count -ne 1) {
  throw "Expected exactly one base --color-accent token, found $($accentMatches.Count)."
}
$accent = $accentMatches[0].Value.Split(':', 2)[1].Trim().TrimEnd(';')
$accentHex = Convert-OklchToHex `
  ([double]::Parse($accentMatches[0].Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)) `
  ([double]::Parse($accentMatches[0].Groups[2].Value, [Globalization.CultureInfo]::InvariantCulture)) `
  ([double]::Parse($accentMatches[0].Groups[3].Value, [Globalization.CultureInfo]::InvariantCulture))

$iconSource = [System.IO.File]::ReadAllText($iconTemplatePath, [System.Text.Encoding]::UTF8)
try {
  $iconDocument = [System.Xml.Linq.XDocument]::Parse(
    $iconSource,
    [System.Xml.Linq.LoadOptions]::PreserveWhitespace
  )
}
catch {
  throw "Could not parse the app icon SVG: $($_.Exception.Message)"
}

$accentNodes = @($iconDocument.Descendants() | Where-Object {
  $attribute = $_.Attribute([System.Xml.Linq.XName]::Get('data-color-token'))
  $null -ne $attribute -and $attribute.Value -eq 'accent'
})
if ($accentNodes.Count -ne 1) {
  throw "Expected exactly one accent color marker in the app icon, found $($accentNodes.Count)."
}
$fillAttribute = $accentNodes[0].Attribute([System.Xml.Linq.XName]::Get('fill'))
if ($null -eq $fillAttribute) {
  throw 'The app icon accent marker must have a fill attribute.'
}
$fillAttribute.Value = $accentHex
$resolvedIconSource = $iconDocument.ToString([System.Xml.Linq.SaveOptions]::DisableFormatting)
[System.IO.File]::WriteAllText($resolvedIconPath, $resolvedIconSource, $utf8WithoutBom)

$temporaryRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporaryOutput = Join-Path $temporaryRoot "mono-windows-icon-$PID-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $temporaryOutput -ErrorAction Stop | Out-Null

try {
  Push-Location $workspaceRoot
  try {
    & npm run tauri --workspace '@mono/desktop' -- icon $resolvedIconPath --output $temporaryOutput
    if ($LASTEXITCODE -ne 0) {
      throw "Tauri icon generation failed with exit code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }

  $generatedWindowsIcon = Join-Path $temporaryOutput 'icon.ico'
  if (-not (Test-Path -LiteralPath $generatedWindowsIcon -PathType Leaf)) {
    throw 'Tauri did not generate icon.ico.'
  }
  Copy-Item -LiteralPath $generatedWindowsIcon -Destination $windowsIconPath -Force -ErrorAction Stop
}
finally {
  if (Test-Path -LiteralPath $temporaryOutput) {
    $resolvedTemporaryOutput = (Resolve-Path -LiteralPath $temporaryOutput).Path
    if ([System.IO.Path]::GetDirectoryName($resolvedTemporaryOutput) -ne $temporaryRoot.TrimEnd('\')) {
      throw "Refusing to clean unexpected path: $resolvedTemporaryOutput"
    }
    $temporaryItems = @(Get-ChildItem -LiteralPath $resolvedTemporaryOutput -Recurse -Force)
    $reparsePoints = @($temporaryItems | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint })
    if ($reparsePoints.Count -ne 0) {
      throw "Refusing to clean temporary icon output containing reparse points: $resolvedTemporaryOutput"
    }
    Remove-Item -LiteralPath $resolvedTemporaryOutput -Recurse -Force -ErrorAction Stop
  }
}

Write-Output "Windows branding synced from $accent to $accentHex"
