# Third-party notices

`apps/desktop/src/main/auth-detection.ts` adapts the code formats, context and
candidate scoring from [AuthFill](https://github.com/authfill/authfill),
`apps/extension/src/utils/detection.ts`, at commit
`7462d616bc781f07945d5ea87345c316ef2583fa` (AuthFill contributors).
The original code is licensed under GNU GPL version 3; its license is included in
[`authfill-GPL-3.0.txt`](authfill-GPL-3.0.txt).

Modified for inlark on 2026-10-24 to support automatic copying, German context,
confidence and ambiguity checks, bounded input, code normalization and safer URL
parsing. The combined application is distributed under inlark's GNU AGPL version 3.
