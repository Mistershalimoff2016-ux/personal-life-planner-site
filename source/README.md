# GPL-3.0 corresponding source — Simple Planner V1

[Download exact source](personal-life-planner-f713373e.zip). Source revision `f713373ec5468bd9d93d7d63cd99946affe68914`.
Original author: [Jinjinov / OpenHabitTracker](https://github.com/Jinjinov/OpenHabitTracker).

SHA-256: `19da722d686401fbf453897bab19dbbc309585abb275cc07ed4c3128a7ce167b`. Full tracked source and build scripts, except runtime `.env`,
Git history and upstream TestFixtures backup/database samples. No excluded file is
needed to compile the PWA. Earlier source archives are retained for previously distributed versions.

With .NET SDK 10 and Python 3, extract the ZIP and run from its root:

```sh
dotnet publish OpenHabitTracker.Blazor.Wasm/OpenHabitTracker.Blazor.Wasm.csproj -c Release -o publish
python3 scripts/prepare-pwa.py publish/wwwroot --base /personal-life-planner-site/
```

Serve `publish/wwwroot` at that prefix on a static HTTPS host. The application uses
local IndexedDB and does not need the server project. See docs/SIMPLE-PLANNER-V1.md
and docs/PRODUCTION-FIX.md. See ../PUBLIC-SOURCE-NOTES.txt for exclusions.
