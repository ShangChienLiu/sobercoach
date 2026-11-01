# How other agents remember (field survey, 2026-11-01)

Why this exists: before adding a way for the coach to look things up in earlier chats, we checked whether the agents people use this autumn keep a vector database over past conversations, or something else. Web research on 2026-11-01; "[confirmed]" is vendor documentation, "[reported]" press or community, "[inferred]" reverse engineering or model self-report, "[not found]" nothing published.

## Consumer agents

| Product | What is stored | Vector retrieval over past chats? | What the user can see or delete | Sources |
|---|---|---|---|---|
| xAI Grok Bot | "Stable preferences, role context, and summaries of prior work" per Bot; name and time zone shared across Bots. Model-written summaries, not transcripts [confirmed] | Not mentioned anywhere [not found] | Only by asking "what do you remember about me"; deleting a Bot leaves files on its computer [confirmed] | docs.x.ai/grok-bot/faq · venturebeat.com (2026-08-11) |
| Meta Muse | Text files in the user's "Muse Secure VM": the help page tells users to look at files such as MEMORY.md; the forget skill searches "memories and supporting files" [confirmed]. WIRED and TIME (Oct 2026) reported leaked instructions to update structured files on the user and every person mentioned, hourly [reported] | No official mention; one second-hand note that forget "rebuilds the index" [unverified] | View and edit MEMORY.md; forget is best effort ("Muse may still remember information it learned from what you deleted") [confirmed] | about.fb.com (2026-09-08) · meta.com/help (Sept 2026) · aiagentslibrary.com (2026-10-25) |
| OpenAI dots and ChatGPT | Dots "draw on ChatGPT memory and also build their own notes". ChatGPT: editable saved memories plus "reference chat history" with no stated mechanism [confirmed] | Reverse engineering (Dec 2025) found injected facts plus about 15 precomputed recent-conversation digests and concluded no vector database, no RAG over history [inferred] | Dot memories "cannot currently be viewed, deleted or edited", only a full reset [confirmed] | help.openai.com dot article · manthanguptaa.in/posts/chatgpt_memory · vellum.ai (2026-09-29) |
| Anthropic Claude and Duet | Topic entries the user can edit; the API memory tool is a file directory with view, create, replace and delete commands and no search primitive; Managed Agents mount a store of text documents [confirmed] | **Yes, as a separate feature**: "search past chats" is described as retrieval-augmented generation, appears as a tool call, only when the user asks, with citations to the source chats [confirmed] | Per-entry edit and delete; the search toggle can be turned off [confirmed] | support.claude.com memory article · platform.claude.com memory tool · anthropic.com context-engineering post (2025-09-29) |

## Open-source agents and memory libraries

| System | Vector store | Primary memory representation | Source |
|---|---|---|---|
| OpenClaw memory-core | Default on (SQLite plus sqlite-vec, hybrid with FTS5), but markdown is the source of truth and the index is rebuildable | MEMORY.md and USER.md loaded at start; dated episodic notes reached by search; the nightly dreaming pass is the only writer of durable memory | docs.openclaw.ai/concepts/memory-architecture |
| Hermes Agent | None built in; SQLite FTS5 keyword search over sessions; vectors only through optional providers (mem0, Zep and others) | MEMORY.md and USER.md injected into the system prompt | hermes-agent.nousresearch.com memory docs |
| nanobot | None (roadmap item, not shipped) | SOUL.md, USER.md, MEMORY.md plus an append-only history.jsonl of summaries searched with grep | github.com/HKUDS/nanobot docs/memory.md |
| Letta (MemGPT) | Historically yes; March 2026 pivot to "MemFS", git-backed markdown directories | Markdown files | letta.com/blog/our-next-phase |
| mem0 | Yes, extracted facts with hybrid retrieval | Atomic facts | arxiv.org/abs/2504.19413 |
| Zep / Graphiti | Yes, hybrid with a temporal knowledge graph | Entity graph with validity intervals | arxiv.org/abs/2501.13956 |

## What the benchmarks say

- Retrieval beats full context on long histories (Zep on LongMemEval 63.8% vs 60.2%, with 70× fewer tokens), full context wins on short histories (LoCoMo, +7.8 points for full context in one practitioner test).
- An independent re-implementation of 12 memory systems (arXiv 2604.01707, Aug 2026): keeping raw dialogue is essential to avoid semantic loss; extracted facts alone lose information.
- Letta's filesystem experiment: the raw transcript in a file plus grep and a search tool scored 74.0% on LoCoMo against mem0's 68.5%; their reading is that knowing when to call retrieval matters more than the retrieval mechanism.
- No neutral head-to-head of "model-written notes" against "vector retrieval over raw history" for personal assistants exists [not found].

## What SoberCoach does with this

The design already matched the field: structured facts the user stated (14, in their words), one model-written profile rebuilt every five turns (dreaming), the SQL ledger as ground truth, and the last six messages in context. What was missing is the one retrieval feature any consumer agent admits to, Claude's search over past chats. Added on 2026-11-01 as the `search_history` tool:

- The AGENTS model (Haiku) calls it with one to three of the user's own words when the user asks what they said, did or planned before. It is a tool call, visible in the ledger, never silent.
- Code runs a substring search over the user's own earlier messages (RLS-scoped SQL function `search_messages`, case-insensitive, works for Chinese without an extension; coach lines and the user's own questions are excluded so results do not echo earlier answers). Ranked by terms matched, then recency; five hits at most; 180-day window.
- Each hit carries its date and that service day's logged total from the ledger, so the fact line the writer sees is fully verified and the digit guard allows it. The writer adds at most a sentence and a question.
- No embeddings and no second index: at a few thousand messages per user a year, a filtered substring scan is milliseconds, and nothing has to be kept in sync with the ledger. If volume ever makes this slow, Supabase offers pgroonga for CJK-aware full text; pg_trgm is not reliable for Chinese.
