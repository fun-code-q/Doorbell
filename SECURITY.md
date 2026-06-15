# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 3.x | Yes |
| < 3.0.0 | No |

## Reporting a Vulnerability

Please do not open public issues for security vulnerabilities.

1. Use GitHub's **Private vulnerability reporting** on this repository
   (Security tab → "Report a vulnerability") — or email the maintainer
   listed in `CODEOWNERS`
2. Subject line: `QR Doorbell Security Report`
3. Include:
   - affected URL/environment
   - reproduction steps
   - expected vs actual behavior
   - impact assessment
   - proof-of-concept if available

## Response Targets

- Initial acknowledgement: within 72 hours
- Triage outcome: within 7 days
- Fix timeline: based on severity and exploitability

## Severity Guidelines

- Critical: remote data exfiltration, auth bypass, privilege escalation
- High: sensitive data exposure, persistent XSS, broken access control
- Medium: abuse vectors, security misconfiguration with limited impact
- Low: hardening opportunities with minimal exploitability

## Disclosure

Coordinated disclosure is preferred. We will confirm when a fix is released and when public disclosure is safe.
