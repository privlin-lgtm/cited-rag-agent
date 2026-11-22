@AGENTS.md

## How Paul wants code and replies
- Reply with the code first, with no introduction or summary around it. End with a two-line footer: the files touched, and the test and build result.
- Leave out comments and doc headers. Add one only where a line uses a hack nobody could read without it.
- Validate input at the edges: request handlers and the external-API and payment boundaries. Everywhere else, let errors throw. A swallowed exception or a catch that logs and carries on hides the failure from the tests and the logs.
- Don't split React logic into custom hooks or helper functions unless asked.
