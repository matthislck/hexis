import type { NodeType } from "./types";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  nodes: { type: NodeType; position: { x: number; y: number }; config: Record<string, unknown> }[];
  edges: { source: string; target: string }[];
}

const INGEST_PROMPT = `You are maintaining a personal knowledge wiki. A new source document has been provided.

Process this source and produce a structured wiki entry:

# [Descriptive title for this source]

## Overview
One paragraph summarizing what this source is and why it matters.

## Key Insights
The 5–10 most important takeaways as bullet points. Be specific — avoid vague generalities.

## Entities & Concepts
Key people, ideas, terms, or claims introduced. One-line description each.

## Connections
How this relates to or contradicts other knowledge. What prior beliefs does it update?

## Notable Quotes
2–3 verbatim quotes worth preserving exactly as written.

## Open Questions
What does this source raise but not answer? What would be worth investigating next?

---

Be information-dense and precise. This entry will be read by future LLM sessions — write for a knowledgeable reader, not a general audience.`;

const QUERY_PROMPT = `You are a wiki assistant. The personal knowledge base contains a collection of wiki pages provided below.

Synthesize a clear, well-sourced answer using only the provided knowledge.

Format your response as:
1. **Direct answer** (1–2 sentences)
2. **Evidence** — support from the wiki with page references
3. **Gaps & contradictions** — what the wiki doesn't cover or gets wrong
4. **Follow-up questions** worth investigating

If the answer isn't in the wiki, say so clearly rather than guessing.

**Question:** {{question}}`;

const LINT_PROMPT = `You are a wiki health inspector. Review the knowledge base provided below and produce a structured maintenance report.

## Contradictions
Claims on different pages that conflict with each other. Quote both sides.

## Stale or Unsupported Claims
Claims that appear outdated, unverified, or that newer sources likely supersede.

## Orphan Concepts
Important ideas mentioned but never given their own page or proper explanation.

## Missing Cross-References
Connections between pages that exist implicitly but aren't linked explicitly.

## Data Gaps
Topics where the wiki is thin and would benefit from additional sources.

## Suggested Next Sources
3–5 specific sources (papers, articles, books) that would most strengthen this knowledge base.

---

Be direct and specific. A vague health report is useless. Cite page names and quote relevant passages.`;

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "llm-wiki-ingest",
    name: "LLM Wiki · Ingest",
    description: "Process a source document into a structured wiki entry",
    nodes: [
      {
        type: "input",
        position: { x: 80, y: 260 },
        config: { paths: [] },
      },
      {
        type: "prompt",
        position: { x: 380, y: 260 },
        config: {
          prompt: INGEST_PROMPT,
          model: "claude-sonnet-4-6",
          temperature: 0.3,
        },
      },
      {
        type: "output",
        position: { x: 680, y: 260 },
        config: { output_filename: "wiki/{{timestamp}}_entry.md" },
      },
    ],
    edges: [
      { source: "node_0", target: "node_1" },
      { source: "node_1", target: "node_2" },
    ],
  },
  {
    id: "llm-wiki-query",
    name: "LLM Wiki · Query",
    description: "Ask a question against your wiki knowledge base",
    nodes: [
      {
        type: "input",
        position: { x: 80, y: 260 },
        config: { paths: [] },
      },
      {
        type: "prompt",
        position: { x: 380, y: 260 },
        config: {
          prompt: QUERY_PROMPT,
          model: "claude-sonnet-4-6",
          temperature: 0.5,
        },
      },
      {
        type: "output",
        position: { x: 680, y: 260 },
        config: { output_filename: "wiki/answers/{{timestamp}}.md" },
      },
    ],
    edges: [
      { source: "node_0", target: "node_1" },
      { source: "node_1", target: "node_2" },
    ],
  },
  {
    id: "llm-wiki-lint",
    name: "LLM Wiki · Lint",
    description: "Health-check your wiki for gaps, contradictions and orphans",
    nodes: [
      {
        type: "input",
        position: { x: 80, y: 260 },
        config: { paths: [] },
      },
      {
        type: "prompt",
        position: { x: 380, y: 260 },
        config: {
          prompt: LINT_PROMPT,
          model: "claude-opus-4-7",
          temperature: 0.2,
        },
      },
      {
        type: "output",
        position: { x: 680, y: 260 },
        config: { output_filename: "wiki/lint_{{timestamp}}.md" },
      },
    ],
    edges: [
      { source: "node_0", target: "node_1" },
      { source: "node_1", target: "node_2" },
    ],
  },
  {
    id: "agent-research-synthesis",
    name: "Agent · Research Synthesis",
    description: "Agent reads your notes and synthesizes a structured research document",
    nodes: [
      {
        type: "input",
        position: { x: 80, y: 260 },
        config: { paths: [] },
      },
      {
        type: "agent",
        position: { x: 430, y: 260 },
        config: {
          model: "claude-sonnet-4-6",
          max_iterations: 15,
          task: `Read all the provided source material carefully, then produce a structured research synthesis.

1. Identify the core claims, ideas, and themes across the sources
2. Surface connections and tensions between them
3. Note what the sources leave unresolved

Output format:

# [Topic] — Research Synthesis

## Core Thesis
What the evidence points to most strongly. One paragraph, specific.

## Key Findings
The 5–10 most important insights, each with supporting evidence from the sources.

## Tensions & Open Questions
Where the sources disagree, contradict each other, or leave things unresolved.

## Implications
What this means going forward. What would be worth investigating next.

## Sources Referenced
Brief note on each source used.

---

Be information-dense and precise. Write for a knowledgeable reader, not a general audience.`,
        },
      },
      {
        type: "output",
        position: { x: 780, y: 260 },
        config: { output_filename: "synthesis_{{timestamp}}.md" },
      },
    ],
    edges: [
      { source: "node_0", target: "node_1" },
      { source: "node_1", target: "node_2" },
    ],
  },
  {
    id: "agent-essay-draft",
    name: "Agent · Essay from Notes",
    description: "Agent turns rough notes into a structured, well-argued essay",
    nodes: [
      {
        type: "input",
        position: { x: 80, y: 260 },
        config: { paths: [] },
      },
      {
        type: "agent",
        position: { x: 430, y: 260 },
        config: {
          model: "claude-sonnet-4-6",
          max_iterations: 12,
          task: `Read the provided notes. Write a first draft of an essay that:

- Opens with a specific, striking observation — not a broad statement
- Has a clear, arguable thesis (not "this essay examines…")
- Argues from the evidence in the notes — cite specific claims and examples
- Takes an intellectual position and defends it
- Writes in the style of a thoughtful long-form essay (think Stripe Press, Works in Progress, Ribbonfarm)
- Is between 800–1500 words

Do not summarize the notes. Synthesize them into an original argument. The output should read like something worth publishing.`,
        },
      },
      {
        type: "output",
        position: { x: 780, y: 260 },
        config: { output_filename: "essay_draft_{{timestamp}}.md" },
      },
    ],
    edges: [
      { source: "node_0", target: "node_1" },
      { source: "node_1", target: "node_2" },
    ],
  },
  {
    id: "agent-source-critique",
    name: "Agent · Source Critique",
    description: "Agent reads a paper or article and produces a structured critical analysis",
    nodes: [
      {
        type: "input",
        position: { x: 80, y: 260 },
        config: { paths: [] },
      },
      {
        type: "agent",
        position: { x: 430, y: 260 },
        config: {
          model: "claude-opus-4-7",
          max_iterations: 10,
          task: `Read the provided document carefully and produce a structured critical analysis.

## What They Claim
The central argument, stated as charitably as possible in 2–3 sentences.

## Evidence Quality
How strong is the evidence? What methodology was used? What are the data sources? What would falsify this?

## What's Missing
Key objections not addressed. Counterevidence ignored. Gaps in the reasoning. Who would disagree and why?

## What's Surprising
Claims that update a prior belief, or that are underappreciated relative to their importance.

## Connections
How does this relate to or contradict other work in this area?

## One-Line Verdict
How much weight should this source carry, and for what purposes?

---

Be direct and specific. Quote the text when making a critical point. A generous summary followed by honest critique is more useful than vague praise.`,
        },
      },
      {
        type: "output",
        position: { x: 780, y: 260 },
        config: { output_filename: "critique_{{timestamp}}.md" },
      },
    ],
    edges: [
      { source: "node_0", target: "node_1" },
      { source: "node_1", target: "node_2" },
    ],
  },
  {
    id: "agent-connections-map",
    name: "Agent · Connections Map",
    description: "Agent surfaces non-obvious connections across your knowledge base",
    nodes: [
      {
        type: "input",
        position: { x: 80, y: 260 },
        config: { paths: [] },
      },
      {
        type: "agent",
        position: { x: 430, y: 260 },
        config: {
          model: "claude-opus-4-7",
          max_iterations: 15,
          task: `Read the entire knowledge base and produce a connections map — a structured document surfacing the most interesting non-obvious relationships between ideas.

For each connection found, write:
- **Connection name** (e.g., "Licklider's 1960 vision predicts Collison's 2024 complaint")
- What insight does this connection unlock?
- Strength: strong / plausible / speculative

Then provide:

## Clusters
Which ideas form a natural group? Name the cluster and list the members.

## Outliers
Which ideas don't connect to anything else yet? These are either underdeveloped or ahead of the rest.

## Missing Link
What single topic, if added to this knowledge base, would connect the most currently-disconnected ideas?

## Emerging Thesis
What larger claim do these connections point toward, even if no single document makes it explicitly?

---

Prioritize surprising connections over obvious ones. The goal is to surface what the author couldn't see because they were too close to the material.`,
        },
      },
      {
        type: "output",
        position: { x: 780, y: 260 },
        config: { output_filename: "connections_{{timestamp}}.md" },
      },
    ],
    edges: [
      { source: "node_0", target: "node_1" },
      { source: "node_1", target: "node_2" },
    ],
  },
  {
    id: "agent-codebase-explorer",
    name: "Agent · Codebase Explorer",
    description: "Agent explores a codebase and generates structured documentation",
    nodes: [
      {
        type: "input",
        position: { x: 80, y: 260 },
        config: { paths: [] },
      },
      {
        type: "agent",
        position: { x: 430, y: 260 },
        config: {
          model: "claude-sonnet-4-6",
          max_iterations: 20,
          agent_system_prompt: "You are a senior software engineer documenting a codebase for a new team member. Be specific, accurate, and concise.",
          task: `Explore the provided codebase and produce structured documentation.

## Architecture Overview
What is this system? What does it do? What are the main components and how do they relate?

## Entry Points
Where does execution start? What are the main user-facing interfaces?

## Key Files & Modules
For each important file or module: what does it own, what does it depend on?

## Data Flow
How does data move through the system from input to output?

## Non-Obvious Design Decisions
Things that would surprise a new engineer. Workarounds, constraints, historical reasons.

## Getting Started
The 5 things a new engineer needs to know to be productive on day 1.

---

Read the actual code — don't guess. Quote file paths and function names. Be specific enough that a senior engineer could onboard from this document alone.`,
        },
      },
      {
        type: "output",
        position: { x: 780, y: 260 },
        config: { output_filename: "codebase_docs_{{timestamp}}.md" },
      },
    ],
    edges: [
      { source: "node_0", target: "node_1" },
      { source: "node_1", target: "node_2" },
    ],
  },
];
