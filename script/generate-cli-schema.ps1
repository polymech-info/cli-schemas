# Forward every argument to generate-cli-schema.mjs.
#   .\generate-cli-schema.ps1 ffmpeg
#   .\generate-cli-schema.ps1 ffmpeg --no-web
#   .\generate-cli-schema.ps1 ffmpeg --stamp-groups
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& node (Join-Path $here 'generate-cli-schema.mjs') @args
if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }
