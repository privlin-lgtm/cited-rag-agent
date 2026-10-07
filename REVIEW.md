# Review instructions

Tag every finding with its pass and a severity: Important or Nit.

## Passes
- Bugs: logic errors, edge cases, regressions; citation index mapping across rounds; limit and budget arithmetic; ingest versioning.
- Security: secrets reachable from client code, input validation at every route, IP hashing with the secret, the document-text-is-data guard intact, limits checked before any model call.
- Chain compliance: the diff matches spec.md and plan.md; flag anything built that neither mentions.
- Fixed rules: no placeholders or stubbed handlers, no speculative tables or columns, migrations additive, no forced tool_choice, an unchecked citation never shown as checked.

## Severity
Important = breaks behaviour, leaks data or secrets, or breaks a fixed rule.
Everything else is a Nit.

## Limits
At most five nits; summarise the rest as a count.
Skip generated files and anything lint or CI already enforces.
