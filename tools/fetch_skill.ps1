$url1 = 'https://questlog.gg/aion-2/api/trpc/database.getSkill?input=%7B%22id%22%3A%2214710000%22%2C%22language%22%3A%22zh%22%7D'
$url2 = 'https://questlog.gg/aion-2/api/trpc/database.getSkill?input=%7B%22id%22%3A%2214740000%22%2C%22language%22%3A%22zh%22%7D'

foreach ($url in @($url1, $url2)) {
    $content = (Invoke-WebRequest -Uri $url -UseBasicParsing).Content
    $json = [System.Text.Json.JsonDocument]::Parse($content)
    $root = $json.RootElement

    $skillName = $root.GetProperty("result").GetProperty("data").GetProperty("name").GetString()
    Write-Host "=== 技能: $skillName ==="

    $dd = $root.GetProperty("result").GetProperty("data").GetProperty("descriptionData")
    Write-Host "descriptionData text: $($dd.GetProperty('text').GetString())"
    Write-Host ""

    # 列出所有 key
    foreach ($prop in $dd.EnumerateObject()) {
        if ($prop.Name -eq 'text' -or $prop.Name -eq 'variables') { continue }
        $varKey = $prop.Name
        $varVal = $prop.Value
        $modifier = ""
        $property = ""
        try { $modifier = $varVal.GetProperty("modifier").GetString() } catch {}
        try { $property = $varVal.GetProperty("property").GetString() } catch {}

        # 找 Lv16 和 Lv24
        foreach ($lv in @("16", "24")) {
            try {
                $lvData = $varVal.GetProperty("levels").GetProperty($lv)
                $vals = @()
                foreach ($v in $lvData.GetProperty("values").EnumerateArray()) {
                    $vals += $v.GetString()
                }
                Write-Host "  KEY: $varKey"
                Write-Host "    modifier=$modifier  property=$property  Lv${lv} values=[$($vals -join ', ')]"
            }
            catch {}
        }
    }
    Write-Host ""
}
