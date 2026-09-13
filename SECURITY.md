# Security policy

modREEF controls physical aquarium equipment. Treat suspected vulnerabilities,
credential exposure, unsafe equipment behavior, and update-chain problems as
security issues.

## Reporting a vulnerability

Do not open a public issue for an unpatched vulnerability. Use the public
repository's GitHub **Security → Report a vulnerability** form. Dennis Stevens,
the current project steward, receives and coordinates reports. Include the
affected component, version or commit, reproduction conditions, possible
physical impact, and any temporary mitigation you have verified.

Do not include real Wi-Fi passwords, Tuya local keys, controller setup secrets,
cloud tokens, private QR payloads, or unredacted diagnostic archives.

## Supported versions

The latest published controller image and the current qualified production
commit receive security fixes. Older images, development branches, and
experimental device integrations are unsupported unless a release advisory
explicitly says otherwise.

## Safety

If a vulnerability could energize, stop, or misconfigure life-support
equipment, disconnect the affected integration or return it to safe manual
control before collecting diagnostics. Never test against a live aquarium when
an isolated bench setup can reproduce the issue.
