# Five-minute demo

For Paul, on the production URL: https://cited-rag-agent.vercel.app. Before you start, download `lib/fixtures/acme-pay-terms.pdf` from the repository on GitHub (open the file and use "Download raw file"), and open https://cited-rag-agent.vercel.app/api/health once, so the database is awake.

The numbers below were measured on 21 October 2026. The cancellation question cost $0.0285 in 7.1 s and $0.0284 in 7.6 s on the `m6-readme` preview, with every citation checked. The Acme Pay question answered 12 days with 2 of 2 citations checked on production.

1. **0:00–0:30. The page.** Open https://cited-rag-agent.vercel.app.
   - Say: "This is an agent that answers questions about nine cross-border payments documents, and checks every citation it gives against the stored text."
   - Point at the production badge at the top right, and at the nine documents with their licence badges.

2. **0:30–1:45. A checked answer.** Click the example "How long does a sender have to cancel a remittance transfer?".
   - Point at the steps as they appear: each tool the agent called, with its hits and their labelled scores (similarity or keyword rank). The answer text arrives in one piece when it is ready, about 7 to 8 seconds in.
   - Point at the header "N of M citations checked", then click one [n] marker. Show the excerpt it jumps to, with the cited sentences highlighted, and its "Open source" link.

3. **1:45–2:30. How the check works.**
   - Say: "Each search result goes to Claude as a block of separate sentences, and a citation names a result and a range of those sentences."
   - Say: "The server checks every cited sentence against the chunk stored in Postgres, and the file and page shown come from the database, never from the model's text."
   - Say: "Checked means the sentences really are in a passage retrieved in this run. It does not prove that they support the claim; the highlighted excerpt is there so you can judge that."

4. **2:30–3:00. No answer in the documents.** Type "What is the capital of France?" and click Ask.
   - Point at the neutral "no citations" badge, and at the Excerpts column, which says that the answer cites no passage.
   - Say: "When the documents don't cover a question, the agent says so instead of inventing an answer."

5. **3:00–3:45. Your own document.** Under "Your uploads", click "Upload a file" and pick `acme-pay-terms.pdf`.
   - Ask "How many days does an Acme Pay customer have to request a refund?". The answer is 12 days, cited from the upload.
   - Say: "An upload is visible only to this browser session and is deleted after 24 hours." Then delete it with the × button beside it.

6. **3:45–4:30. The evals.** Open the README's "Retrieval evals" section.
   - Point at the table: hit@1 9/14, hit@3 11/14, hit@5 13/14 and MRR 0.750 on 14 questions. The CI run for this release scored the same 13 of 14 at hit@5.
   - Say: "CI ingests the corpus into a fresh database and fails any pull request that drops hit@5 below 12 of 14."

7. **4:30–5:00. Releases.** Open the repository's Actions tab and the Release workflow.
   - Point at a production run waiting for approval: it migrates, ingests the corpus, has Vercel build and deploy the commit, then checks `/api/health`.
   - Open `/api/health` on production; each environment reports its own database.
   - Close with the footer: the model, tokens, cost and latency of the last answer.

## If asked

- **Why not LangChain or another framework?** README, "Decisions": the hand-written agent loop.
- **Why pgvector rather than a vector database?** README, "Decisions": one database for vectors and rows.
- **What is the $0.10 hold?** README, "Decisions": a cost budget, not a question cap; and "Limits and cost".
- **What about prompt injection?** README, "The agent loop": document text is data, and a hostile document cannot forge a checked citation.
- **What happens when Voyage is down?** README, "Decisions": degrade, don't fail; the search falls back to keywords and the step says so.

The demo spends three questions of production's daily budget: about $0.11 at the spec's measured average of $0.0365 a question, and less if each costs what the cancellation question cost here.
