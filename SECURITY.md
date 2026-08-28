# Security policy

modREEF controls physical aquarium equipment. Treat suspected vulnerabilities,
credential exposure, unsafe equipment behavior, and update-chain problems as
security issues.

## Reporting a vulnerability

Do not open a public issue for an unpatched vulnerability. Use GitHub's private
vulnerability reporting for this repository. Include the affected component,
version or commit, reproduction conditions, possible physical impact, and any
temporary mitigation you have verified.

Do not include real Wi-Fi passwords, Tuya local keys, controller setup secrets,
cloud tokens, private QR payloads, or unredacted diagnostic archives.

## Supported versions

Until the first public beta, only the current qualified production commit is
eligible for security fixes. Development branches and experimental device
drivers are not supported releases.

## Safety

If a vulnerability could energize, stop, or misconfigure life-support
equipment, disconnect the affected integration or return it to safe manual
control before collecting diagnostics. Never test against a live aquarium when
an isolated bench setup can reproduce the issue.
