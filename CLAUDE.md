@AGENTS.md

[CRITICAL DESIGN & LANGUAGE CONSTRAINTS]
Target Model: Fable 5.1

1. Output Format: Start directly with the code block. Omit all introductory text, markdown explanations, and post-code summaries. The only text after the code is a two-line footer: files touched, and the test/build result.
2. Zero Commentary: Remove all inline comments, JSDoc, XML documentation, and headers unless a line uses an entirely opaque hack.
3. Failure Handling: Never swallow exceptions. Validate inputs at the edge (request handlers, external-API and payment boundaries); let everything else throw. No speculative try/catch, no catch-log-and-continue.

4. Stack-Specific Rules:
   - React / Next.js: Write compact, idiomatic functional components. Prefer short-circuiting (&&) and ternary operators for conditional rendering unless nesting hurts readability. Do not split logic into premature custom hooks or isolated helper functions unless explicitly requested. Avoid verbose inline styles or excessive nested divs.
   - Node.js: Use modern, dense ES module syntax (async/await, object destructuring, optional chaining). Strip out speculative, multi-layered try/catch middleware or verbose logging blocks. Focus strictly on the happy path execution, subject to rule 3.
   - .NET: Use modern C# features to minimize lines (e.g., file-scoped namespaces, top-level statements, primary constructors, expression-bodied members, and LINQ). Prefer not to generate heavy interface abstractions, separate DTO mappings, or boilerplate setup code unless the prompt explicitly demands them or a type has more than one consumer.
