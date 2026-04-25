# Graphifyy (PyPI) — knowledge graph from your repo

[Graphifyy](https://pypi.org/project/graphifyy/) (package name: **`graphifyy`**, two “y”s) is an **open-source Python tool** that ingests a codebase, docs, images, and other multimodal assets and produces a **persistent, queryable knowledge graph** (not the same as this service’s **GraphQL** endpoint `POST /graphql`, which is a small runtime API for dashboard counts).

Upstream project: [github.com/safishamsi/graphify](https://github.com/safishamsi/graphify) · License: MIT.

## What you get

Typical output (default `graphify-out/`):

| Output | Role |
|--------|------|
| `graph.html` | Interactive graph in a browser |
| `GRAPH_REPORT.md` | “God” nodes, clusters, suggested questions |
| `graph.json` | Durable graph you can re-query without re-indexing the tree |
| `cache/` | Incremental re-runs using SHA256 cache |

## Install (separate from Node)

Requires **Python 3.10+** and **&lt; 3.14** (per current PyPI metadata).

```bash
python -m pip install graphifyy
```

Optional extras: `[pdf]`, `[video]`, `[mcp]`, `all`, etc. — see [PyPI extras](https://pypi.org/project/graphifyy/).

## Run on this monorepo

From `D:\Umer\nexxaura\main_server` (or the repo root that contains `main_server` + `scripts`):

```bash
cd D:\Umer\nexxaura\main_server
graphify .
```

In AI assistants, the same idea is often invoked as **`/graphify .`** (see project README for editor integration).

- Use **`.graphifyignore`** in this folder (or parent repo root) to skip `node_modules/`, `coverage/`, build output, and generated graph artifacts. Same syntax as `.gitignore`.
- Re-run after large refactors; incremental behavior uses the tool’s `cache/`.

## Nexxaura-specific tips

- Include **`../scripts`** in the same graph run (from parent `D:\Umer\nexxaura`) if you want **Office Ally + Availity** Python/JS automation in the same knowledge graph:  
  `cd D:\Umer\nexxaura && graphify .`
- For **this** Node service only, stay in `main_server` so `graphify-out/` stays co-located with the gateway code.

## Relationship to this repository

| Mechanism | Purpose |
|-----------|---------|
| **graphifyy** (CLI) | Offline / assistant workflow: static graph of files & docs |
| **`POST /graphql`** in `main_server` | Runtime API: dashboard counts for the **logged-in user** (see `src/graphql/`) |

They are complementary, not the same.

## Security

Graphifyy may send content to your configured **LLM / subagents** during the semantic pass (per upstream docs). Do not point it at directories that contain **production secrets**; keep secrets in **`.env`** (gitignored) and out of the indexed tree, or add those paths to `.graphifyignore`.
