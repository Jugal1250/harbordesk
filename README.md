# Harbor Desk — adding AI to an existing SaaS platform

A working support console for a fictional B2B SaaS, with three AI features added to it the way
they would be added to a live product: alongside the existing screens, behind a confidence
gate, and with an evaluation that says how well each one actually performs.

The point of the project is the last part. Wiring a language model into an app takes an
afternoon. Knowing whether it is safe to put in front of customers is the work.

---

## What was added

| Feature | What it does | The guardrail |
|---|---|---|
| **Ticket triage** | Reads each ticket and sets category, priority and sentiment, then routes it to a team | Four independent rules send a ticket to a person instead: a policy tripwire on the customer's own words, a never-auto-route category, an urgent priority, or low confidence |
| **Reply drafting (RAG)** | Drafts a reply from the 15-article help centre, with the sources it used | Answers only from retrieved articles; a draft that is not grounded is labelled for a specialist and cites nothing |
| **Ask your data** | Turns a plain-English question into SQL, runs it, charts the result | Generated SQL is validated before execution: SELECT only, one statement, no comments, allowlisted tables. The query is always shown |

Plus an **n8n workflow** that alerts on urgent and security tickets and posts a morning digest.

## Results

From `npm run eval` against Groq (`gpt-oss-20b` for triage, `gpt-oss-120b` for SQL), scored on
40 hand-labelled tickets and 17 analytics questions:

| Triage | |
|---|---|
| category accuracy | 90.0% |
| priority accuracy | 80.0% |
| sentiment accuracy | 72.5% |
| all three correct | 50.0% |
| **missed escalations** | **0** — tickets a human should have seen that were auto-routed |
| unnecessary human review | 0 — see the note on this metric below |
| average latency | 917 ms |

| Ask your data | |
|---|---|
| correct answers | 15/15 |
| safety checks refused | 2/2 — a delete request and an unanswerable question |
| unsafe queries generated | 0 |
| average latency | 868 ms |

Of the 11 tickets held for a person, the policy tripwire caught 8, the category rule 2, the
priority rule 2 — and the confidence gate **0**.

Missed escalations started at 3 and went to 0 across two fixes, both described below. That
number is the one to watch: category accuracy of 90% sounds like a system that is wrong one
ticket in ten, but a wrong *label* on a how-to question costs nothing, while a wrong *route* on
a compliance request costs a contract. They are not the same error and should not share a
metric.

**The confidence gate fired zero times, and that is the most useful thing the evaluation
found.** The model reported 0.7 or higher on all 40 tickets, including the four it got wrong.
Self-reported confidence from a model this size is not a usable signal — it is fluent, not
calibrated. The original design had that gate doing the safety work. Had it shipped, the gate
would have been decoration and a single category check would have been the only thing between
a compliance request and an automatic route. The gate stays in, because a larger model or a
harder ticket set may well make it earn its place, but nothing is allowed to depend on it.

Scores move a percentage point or two between runs at temperature 0 — the figures above are
one run, not an average, and `eval/report.json` has the per-ticket detail behind them.

The Evaluation page in the app shows the same figures, plus every ticket where the model
disagreed with the label. Listing the failures is deliberate: the headline accuracy tells a
client nothing about which ticket types still need a person.

## Running it

```bash
npm install
cp .env.example .env          # add a free Groq key from console.groq.com/keys
npm run seed                  # builds data/harbordesk.sqlite
npm run dev                   # API on :8787, UI on :5173
npm run eval                  # scores triage and ask-your-data, writes eval/report.json
npm test                      # guardrail unit tests
```

No key to hand? `AI_PROVIDER=mock` runs everything offline against a rules baseline, so the
app, the tests and the evaluation all work with no account.

## Design decisions worth defending

**A confidence gate, not an accuracy target.** The model returns its own confidence and
anything under `CONFIDENCE_THRESHOLD` (0.7 by default) is queued for a person. Security,
cancellation and unclear tickets always are, whatever the score. The evaluation tracks the two
error types separately, because they cost very different amounts: a *missed escalation* is a
security report auto-filed to the wrong team, while *unnecessary human review* is just someone
glancing at a queue.

**The retrieval is BM25, not embeddings.** The corpus is 15 short help articles where customer
wording overlaps heavily with the docs, so lexical search with a small synonym map is accurate
here, needs no second API, no key, and no index to rebuild. A relevance floor means an
unrelated question retrieves *nothing*, which is what makes the reply step hand it to a human
rather than draft from an article that does not apply. Swapping in an embedding index means
replacing one file, and is worth doing once the corpus grows or users paraphrase heavily.

**The model writes SQL; it does not decide what is safe to run.** `validateSql` is a whitelist:
SELECT or WITH only, one statement, no comments, no system tables, and every table named after
FROM or JOIN must be one of four. Anything unrecognised is refused rather than allowed through,
and a refusal is shown to the user with the reason.

**Two models, chosen per job.** Triage runs on the smaller model, because it runs on every
incoming ticket and cost scales with volume. Reply drafting and SQL use the larger one, where
quality matters more than throughput. One environment variable each, so a model being retired
is a config change rather than a code change — which it already was once during this build.

**The routing rules do not all read the model's output.** Three of the four do: category,
priority, confidence. The fourth matches the customer's own words against a policy list before
the model runs at all. That matters because the first three share a single point of failure —
they are reading a label that the model produced, so none of them can fire when the label
itself is wrong. See below.

## What testing and evaluation actually caught

Four defects, in code that looked finished. Two came from the unit tests, two from the
evaluation — and the two kinds of testing caught two different kinds of bug.

**From the guardrail tests:**

1. `WITH recent AS (...) SELECT ... FROM recent` was rejected as an "unknown table", because
   the validator checked table names without collecting CTE aliases first. Valid analytics
   queries would have been refused.
2. Retrieval returned weak incidental matches for questions the help centre does not cover, so
   an unrelated ticket would have been drafted from an irrelevant article. Fixed with a
   relevance floor, which is now also what marks a draft for human review.

**From the evaluation — both in the routing logic, and both invisible to unit tests:**

3. *Three urgent tickets were auto-routed.* A team locked out, a customer charged after
   cancelling, a refund chased twice — the model labelled all three `urgent` correctly, at 0.95
   confidence, and the rule sent them straight to a queue anyway, because it only ever checked
   the *category*. High confidence is a reason to trust the label; it is not a reason to skip
   the person. Adding `urgent` to the always-human set took missed escalations from 3 to 1.
4. *The last one was a different problem entirely.* A security ticket — "our insurer is asking
   whether we enforce 2FA", "procurement wants your SOC 2 report" — reads exactly like a
   how-to question, so the model answered `how_to` at high confidence and the
   `security ⇒ human` rule never fired. There was no security ticket as far as the rule could
   see.

   No amount of prompt tuning fixes that, because the fix would be trusting the component that
   just failed. The answer was a deterministic screen (`server/ai/sensitive.js`) that matches
   the *customer's* words — `SOC 2`, `2FA`, `revoke`, `cancel`, `pause billing` — before the
   model runs, and sends the ticket to a person whatever the model later decides. Its term
   lists are written from support policy, not from the tickets that failed.

   It is not a replacement for the model rules, it is the other half of them. The screen
   catches 7 of the 10 tickets that must reach a human on text alone; the three it cannot see
   ("it doesnt work", "nobody can log in", "account closed but still charged") are exactly the
   ones the model handles well. Each covers the other's blind spot.

   The cost is real and is reported rather than hidden: the screen queues a "Downgrade to
   Starter" ticket that no rule required. One extra glance at a queue, against a compliance
   commitment going out without review — that is the trade, stated so a client can disagree
   with it.

   A caveat on how that cost is counted. `unnecessary human review` only counts tickets the
   model *also categorised correctly*, so it isolates "right label, queued anyway". A ticket
   that is both mislabelled and queued shows up in the accuracy figures and not in this one, so
   the reported 0 is a floor rather than the whole cost. Left as it is, and documented, because
   a metric that quietly changes definition is worse than one with a stated limit.

## Honest limitations

- **The mock provider's triage score is optimistic.** Its keyword rules were written against
  these same 40 tickets, so it is fitted to the test set. It is a floor for comparison and a
  way to run offline, not a fair baseline.
- **The policy tripwire is a blunt instrument.** It matches words, so it will queue a ticket
  that merely mentions cancelling. That is the intended direction to be wrong in, but on a
  real support volume the list needs tuning against production tickets, not 40 samples.
- **Scoring for ask-your-data compares result sets, not SQL.** A differently-written query that
  returns the right rows passes, including one that selects a useful extra column. An earlier
  version compared exact result shapes and failed four correct queries — measuring conformity
  rather than correctness.
- **The free tier rate-limits.** A full run hits a few 429s; the provider backs off and retries
  on the header's `retry-after`, so the run completes, just slower. A production deployment
  wants a paid tier and a queue rather than in-process retries.
- **40 tickets is a small evaluation set.** Enough to catch systematic problems and compare
  prompts, not enough for a confident accuracy figure to three decimal places.
- **Single-tenant demo.** No authentication, no per-customer isolation, SQLite on disk. A real
  deployment needs all three.

## Layout

```
server/
  index.js        Express API: existing endpoints + the AI routes
  db.js           SQLite via sql.js, plus the schema shown to the SQL model
  seed.js         Builds the demo database
  ai/
    provider.js   The only file that talks to a model vendor
    mock.js       Offline rules baseline
    triage.js     Classification + the routing decision
    sensitive.js  Policy tripwire on the raw ticket, independent of the model
    retrieve.js   BM25 search over the help centre
    reply.js      Grounded drafting with citations
    sqlgen.js     NL to SQL + the safety validator
    guardrails.test.js
client/src/       React console: Inbox, Ticket, Ask your data, Evaluation
eval/
  tickets.json    40 tickets with ground-truth labels
  questions.json  17 questions with reference SQL, 2 of them safety checks
  run.js          Scoring harness
kb/               15 help centre articles
n8n/              Urgent alert + daily digest workflow
```
