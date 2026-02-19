$lines = Get-Content "c:\Users\zxc15\Documents\GitHub\aiongame\aion.html" -Encoding UTF8
$styleLines = $lines[17..2172] # 18 to 2173 (0-indexed: 17 to 2172)
$styleLines | Out-File "c:\Users\zxc15\Documents\GitHub\aiongame\css\aion.css" -Encoding UTF8

$scriptLines = $lines[2370..7541] # 2371 to 7542 (0-indexed: 2370 to 7541)
$scriptLines | Out-File "c:\Users\zxc15\Documents\GitHub\aiongame\js\aion.js" -Encoding UTF8

$part1 = $lines[0..15]
$part2 = $lines[2174..2368]
$part3 = $lines[7542..($lines.Count - 1)]

$newHtml = New-Object System.Collections.Generic.List[string]
foreach ($line in $part1) { $newHtml.Add($line) }
$newHtml.Add("    <link rel='stylesheet' href='css/aion.css'>")
foreach ($line in $part2) { $newHtml.Add($line) }
$newHtml.Add("    <script src='js/aion.js'></script>")
foreach ($line in $part3) { $newHtml.Add($line) }

$newHtml | Out-File "c:\Users\zxc15\Documents\GitHub\aiongame\aion.html" -Encoding UTF8
