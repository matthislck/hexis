import json
import uuid
from pathlib import Path
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from models import init_db, get_db
from engine import execute_workflow, _run_claude_cli
from notion_bridge import search_pages
import git_bridge

app = FastAPI(title="Hexis Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")  # noqa: deprecated but works fine in FastAPI < 0.109
def startup():
    init_db()
    DEFAULT_WS_ROOT.mkdir(parents=True, exist_ok=True)
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)


# ── Workspaces ────────────────────────────────────────────────────────────────

class WorkspaceCreate(BaseModel):
    name: str
    path: str = ""


@app.get("/workspaces")
def list_workspaces():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM workspaces").fetchall()
    return [dict(r) for r in rows]


DEFAULT_WS_ROOT = Path.home() / "Hexis" / "workspaces"
TEMPLATES_DIR = Path.home() / "Hexis" / "templates"


@app.get("/workspaces/default-root")
def get_default_root():
    return {"path": str(DEFAULT_WS_ROOT)}


@app.post("/workspaces", status_code=201)
def add_workspace(body: WorkspaceCreate):
    if body.path:
        p = Path(body.path)
    else:
        p = DEFAULT_WS_ROOT / body.name
    if not p.exists():
        p.mkdir(parents=True, exist_ok=True)
    elif not p.is_dir():
        raise HTTPException(400, "Path exists but is not a directory")
    for folder in ("prompts", "sources", "outputs"):
        (p / folder).mkdir(parents=True, exist_ok=True)
    readme = p / "sources" / "README.md"
    if not readme.exists():
        readme.write_text(
            "# Sources\n\nDrop your source documents here — articles, papers, notes, transcripts.\n",
            encoding="utf-8",
        )
    wid = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            "INSERT INTO workspaces (id, name, path) VALUES (?, ?, ?)",
            (wid, body.name, str(p)),
        )
    return {"id": wid, "name": body.name, "path": str(p)}


@app.delete("/workspaces/{wid}")
def delete_workspace(wid: str):
    with get_db() as conn:
        conn.execute("DELETE FROM workspaces WHERE id = ?", (wid,))
    return {"ok": True}


# ── User Templates ─────────────────────────────────────────────────────────────

class UserTemplateCreate(BaseModel):
    name: str
    description: str = ""
    nodes: list
    edges: list


@app.get("/user-templates")
def list_user_templates():
    templates = []
    for f in sorted(TEMPLATES_DIR.glob("*.json")):
        try:
            templates.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            pass
    return templates


@app.post("/user-templates", status_code=201)
def save_user_template(body: UserTemplateCreate):
    tid = str(uuid.uuid4())
    data = {
        "id": tid,
        "name": body.name,
        "description": body.description,
        "nodes": body.nodes,
        "edges": body.edges,
    }
    (TEMPLATES_DIR / f"{tid}.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return data


@app.delete("/user-templates/{tid}")
def delete_user_template(tid: str):
    f = TEMPLATES_DIR / f"{tid}.json"
    if f.exists():
        f.unlink()
    return {"ok": True}


class NotionTokenUpdate(BaseModel):
    token: str = ""


@app.put("/workspaces/{wid}/notion-token")
def set_notion_token(wid: str, body: NotionTokenUpdate):
    with get_db() as conn:
        conn.execute("UPDATE workspaces SET notion_token = ? WHERE id = ?", (body.token or None, wid))
    return {"ok": True}


@app.get("/workspaces/{wid}/notion-token")
def get_notion_token(wid: str):
    ws = _get_workspace(wid)
    return {"token": ws.get("notion_token") or ""}


class ApiKeyUpdate(BaseModel):
    key: str = ""


@app.put("/workspaces/{wid}/anthropic-key")
def set_anthropic_key(wid: str, body: ApiKeyUpdate):
    with get_db() as conn:
        conn.execute("UPDATE workspaces SET anthropic_key = ? WHERE id = ?", (body.key or None, wid))
    return {"ok": True}


@app.get("/workspaces/{wid}/anthropic-key")
def get_anthropic_key(wid: str):
    ws = _get_workspace(wid)
    return {"key": ws.get("anthropic_key") or ""}


@app.put("/workspaces/{wid}/openai-key")
def set_openai_key(wid: str, body: ApiKeyUpdate):
    with get_db() as conn:
        conn.execute("UPDATE workspaces SET openai_key = ? WHERE id = ?", (body.key or None, wid))
    return {"ok": True}


@app.get("/workspaces/{wid}/openai-key")
def get_openai_key(wid: str):
    ws = _get_workspace(wid)
    return {"key": ws.get("openai_key") or ""}


@app.put("/workspaces/{wid}/gemini-key")
def set_gemini_key(wid: str, body: ApiKeyUpdate):
    with get_db() as conn:
        conn.execute("UPDATE workspaces SET gemini_key = ? WHERE id = ?", (body.key or None, wid))
    return {"ok": True}


@app.get("/workspaces/{wid}/gemini-key")
def get_gemini_key(wid: str):
    ws = _get_workspace(wid)
    return {"key": ws.get("gemini_key") or ""}


@app.get("/workspaces/{wid}/notion/pages")
async def notion_search_pages(wid: str, q: str = ""):
    ws = _get_workspace(wid)
    token = ws.get("notion_token") or ""
    if not token:
        raise HTTPException(400, "Notion token not configured")
    try:
        results = await search_pages(token, q)
    except Exception as e:
        raise HTTPException(502, f"Notion search failed: {e}")
    return results


# ── Files ─────────────────────────────────────────────────────────────────────

@app.get("/workspaces/{wid}/files")
def list_files(wid: str):
    ws = _get_workspace(wid)
    root = Path(ws["path"])
    files = []
    for f in root.rglob("*"):
        if f.is_file() and not any(part.startswith(".") for part in f.parts):
            files.append(str(f.relative_to(root)))
    return files


@app.get("/workspaces/{wid}/files/{file_path:path}")
def read_file(wid: str, file_path: str):
    ws = _get_workspace(wid)
    full = Path(ws["path"]) / file_path
    if not full.is_file():
        raise HTTPException(404, "File not found")
    return {"path": file_path, "content": full.read_text(encoding="utf-8")}


class FileWrite(BaseModel):
    content: str


@app.put("/workspaces/{wid}/files/{file_path:path}")
def write_file(wid: str, file_path: str, body: FileWrite):
    ws = _get_workspace(wid)
    full = Path(ws["path"]) / file_path
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_text(body.content, encoding="utf-8")
    if file_path.endswith(".md"):
        git_bridge.auto_commit(Path(ws["path"]), f"hexis: edit {file_path}")
    return {"ok": True}


@app.delete("/workspaces/{wid}/files/{file_path:path}")
def delete_file(wid: str, file_path: str):
    from send2trash import send2trash
    ws = _get_workspace(wid)
    full = Path(ws["path"]) / file_path
    if not full.is_file():
        raise HTTPException(404, "File not found")
    send2trash(str(full))
    return {"ok": True}


# ── Workflows ─────────────────────────────────────────────────────────────────

def _workflows_dir(ws: dict) -> Path:
    d = Path(ws["path"]) / ".workflows"
    d.mkdir(exist_ok=True)
    return d


@app.get("/workspaces/{wid}/workflows")
def list_workflows(wid: str):
    ws = _get_workspace(wid)
    d = _workflows_dir(ws)
    workflows = []
    for f in sorted(d.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            workflows.append({"id": data["id"], "name": data["name"], "version": data["version"]})
        except (json.JSONDecodeError, KeyError):
            continue  # skip corrupted or incomplete workflow files
    return workflows


@app.post("/workspaces/{wid}/workflows", status_code=201)
def create_workflow(wid: str, body: dict):
    ws = _get_workspace(wid)
    wf_id = str(uuid.uuid4())
    body.update({"id": wf_id, "version": 1, "workspace_id": wid})
    d = _workflows_dir(ws)
    (d / f"{wf_id}.json").write_text(json.dumps(body, indent=2), encoding="utf-8")
    return body


@app.get("/workspaces/{wid}/workflows/{wfid}")
def get_workflow(wid: str, wfid: str):
    ws = _get_workspace(wid)
    f = _workflows_dir(ws) / f"{wfid}.json"
    if not f.exists():
        raise HTTPException(404, "Workflow not found")
    return json.loads(f.read_text(encoding="utf-8"))


@app.put("/workspaces/{wid}/workflows/{wfid}")
def update_workflow(wid: str, wfid: str, body: dict):
    ws = _get_workspace(wid)
    f = _workflows_dir(ws) / f"{wfid}.json"
    if not f.exists():
        raise HTTPException(404, "Workflow not found")
    existing = json.loads(f.read_text(encoding="utf-8"))
    body["version"] = existing.get("version", 1) + 1
    body["id"] = wfid
    body["workspace_id"] = wid
    f.write_text(json.dumps(body, indent=2), encoding="utf-8")
    return body


@app.delete("/workspaces/{wid}/workflows/{wfid}")
def delete_workflow(wid: str, wfid: str):
    ws = _get_workspace(wid)
    f = _workflows_dir(ws) / f"{wfid}.json"
    if f.exists():
        f.unlink()
    return {"ok": True}


# ── Run ───────────────────────────────────────────────────────────────────────

class RunRequest(BaseModel):
    staleness: dict = {}


@app.post("/workspaces/{wid}/workflows/{wfid}/run")
async def run_workflow(wid: str, wfid: str, body: RunRequest = RunRequest()):
    ws = _get_workspace(wid)
    f = _workflows_dir(ws) / f"{wfid}.json"
    if not f.exists():
        raise HTTPException(404, "Workflow not found")
    workflow = json.loads(f.read_text(encoding="utf-8"))
    workspace_path = Path(ws["path"])

    # load cached node outputs from the last run (for incremental execution)
    cached_outputs: dict = {}
    with get_db() as conn:
        row = conn.execute(
            "SELECT node_outputs FROM runs WHERE workspace_id = ? AND workflow_id = ? "
            "ORDER BY timestamp DESC LIMIT 1",
            (wid, wfid),
        ).fetchone()
    if row and row["node_outputs"]:
        cached_outputs = json.loads(row["node_outputs"])

    async def stream():
        run_record = None
        notion_token = ws.get("notion_token") or None
        anthropic_key = ws.get("anthropic_key") or None
        openai_key = ws.get("openai_key") or None
        gemini_key = ws.get("gemini_key") or None
        async for chunk in execute_workflow(workflow, workspace_path, body.staleness, cached_outputs, notion_token, anthropic_key, openai_key, gemini_key):
            yield chunk
            if chunk.startswith("event: done"):
                data_line = chunk.split("\ndata: ", 1)[1].strip()
                run_record = json.loads(data_line)
        if run_record:
            commit_hash = git_bridge.auto_commit(
                workspace_path,
                _run_commit_message(workflow, run_record),
            )
            if commit_hash:
                run_record["git_commit_hash"] = commit_hash
            _save_run(run_record)

    return StreamingResponse(stream(), media_type="text/event-stream")


# ── Runs ──────────────────────────────────────────────────────────────────────

@app.get("/workspaces/{wid}/runs")
def list_runs(wid: str):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, workflow_id, timestamp, duration_ms, status, model, token_count "
            "FROM runs WHERE workspace_id = ? ORDER BY timestamp DESC",
            (wid,),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/workspaces/{wid}/runs/{rid}")
def get_run(wid: str, rid: str):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM runs WHERE id = ? AND workspace_id = ?", (rid, wid)).fetchone()
    if not row:
        raise HTTPException(404, "Run not found")
    r = dict(row)
    for field in ("input_snapshot", "prompt_snapshot", "node_outputs"):
        if r.get(field):
            r[field] = json.loads(r[field])
        elif field not in r or r[field] is None:
            r[field] = {}
    return r


# ── Prompts ───────────────────────────────────────────────────────────────────

@app.get("/workspaces/{wid}/prompts")
def list_prompts(wid: str):
    ws = _get_workspace(wid)
    root = Path(ws["path"])

    prompt_files = sorted(
        str(f.relative_to(root))
        for f in root.rglob("*.prompt.md")
        if not any(part.startswith(".") for part in f.relative_to(root).parts)
    )

    # scan workflows for usage
    wf_dir = _workflows_dir(ws)
    usage: dict[str, list[dict]] = {p: [] for p in prompt_files}
    for wf_file in sorted(wf_dir.glob("*.json")):
        try:
            wf = json.loads(wf_file.read_text(encoding="utf-8"))
            ref = {"id": wf.get("id", ""), "name": wf.get("name", "")}
            for node in wf.get("nodes", []):
                cfg = node.get("config", {})
                for key in ("prompt_file", "task_file"):
                    val = cfg.get(key, "")
                    if val in usage and ref not in usage[val]:
                        usage[val].append(ref)
        except (json.JSONDecodeError, KeyError):
            continue

    return [{"path": p, "used_in": usage.get(p, [])} for p in prompt_files]


# ── Native folder picker ──────────────────────────────────────────────────────

@app.post("/pick-folder")
def pick_folder():
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.wm_attributes("-topmost", 1)
        folder = filedialog.askdirectory(title="Choose folder")
        root.destroy()
        return {"path": folder or ""}
    except Exception as e:
        raise HTTPException(500, f"Folder picker failed: {e}")


# ── Generate ─────────────────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    description: str


@app.post("/workspaces/{wid}/generate/prompt")
async def generate_prompt(wid: str, body: GenerateRequest):
    ws = _get_workspace(wid)
    workspace_path = Path(ws["path"])

    instruction = (
        f"Write a reusable LLM prompt for the following task:\n\n{body.description}\n\n"
        "Rules:\n"
        "- Use {{input}} where the document content should be inserted\n"
        "- Use {{previous_output}} to reference output from a previous workflow step\n"
        "- Be specific, structured, and direct\n"
        "- Output ONLY the prompt text, no explanation or wrapper"
    )

    try:
        chunks = []
        async for chunk, _, is_meta in _run_claude_cli(instruction, "claude-sonnet-4-6", workspace_path):
            if not is_meta:
                chunks.append(chunk)
        content = "".join(chunks).strip()
    except Exception as e:
        raise HTTPException(502, f"Generation failed: {e}")

    import re
    slug = re.sub(r"[^a-z0-9]+", "-", body.description.lower().strip())[:40].strip("-")
    filename = f"{slug}.prompt.md"
    root = Path(ws["path"])
    prompts_dir = root / "prompts"
    prompts_dir.mkdir(exist_ok=True)
    full = prompts_dir / filename
    counter = 1
    while full.exists():
        full = prompts_dir / f"{slug}-{counter}.prompt.md"
        counter += 1

    full.write_text(content, encoding="utf-8")
    return {"path": str(full.relative_to(root)), "content": content}


@app.post("/workspaces/{wid}/generate/workflow")
async def generate_workflow_endpoint(wid: str, body: GenerateRequest):
    ws = _get_workspace(wid)
    workspace_path = Path(ws["path"])

    instruction = (
        "You are a workflow designer for Hexis, a document automation tool.\n\n"
        "Available node types:\n"
        "- input: reads workspace files. config: { paths: [] }\n"
        "- prompt: sends content to an LLM. config: { prompt: string, model: 'claude-sonnet-4-6', backend: 'claude-cli' }\n"
        "- agent: runs an AI coding agent. config: { task: string, model: 'claude-sonnet-4-6' }\n"
        "- output: saves result to file. config: { filename: 'outputs/output_{{timestamp}}.md' }\n\n"
        "Return ONLY a valid JSON object — no explanation, no markdown fences:\n"
        "{\n"
        '  "name": "workflow name",\n'
        '  "nodes": [\n'
        '    { "id": "node_0", "type": "input", "position": { "x": 100, "y": 200 }, "config": {} }\n'
        "  ],\n"
        '  "edges": [\n'
        '    { "source": "node_0", "target": "node_1" }\n'
        "  ]\n"
        "}\n\n"
        f"Space nodes 350px apart horizontally, centered at y=200. Keep it simple — 2-4 nodes.\n\n"
        f"Create a workflow for: {body.description}"
    )

    try:
        chunks = []
        async for chunk, _, is_meta in _run_claude_cli(instruction, "claude-sonnet-4-6", workspace_path):
            if not is_meta:
                chunks.append(chunk)
        content = "".join(chunks).strip()
    except Exception as e:
        raise HTTPException(502, f"Generation failed: {e}")

    import re
    json_match = re.search(r"\{[\s\S]+\}", content)
    if not json_match:
        raise HTTPException(500, "Model returned invalid JSON")

    try:
        workflow_data = json.loads(json_match.group())
    except json.JSONDecodeError as e:
        raise HTTPException(500, f"JSON parse error: {e}")

    return workflow_data


def _run_commit_message(workflow: dict, run_record: dict) -> str:
    import hashlib

    def _h(text: str) -> str:
        return hashlib.sha1(text.encode()).hexdigest()[:7]

    name     = workflow.get("name", "workflow")
    wf_ver   = workflow.get("version", 1)
    duration = run_record.get("duration_ms", 0) / 1000
    tokens   = run_record.get("token_count", 0)

    tok_str = f" · {tokens:,} tok" if tokens else ""
    subject = f"hexis: run \"{name}\" v{wf_ver} ({duration:.1f}s{tok_str})"

    lines = [subject, ""]
    W = 12  # label column width

    lines.append(f"{'workflow':<{W}}{name}  ·  v{wf_ver}")

    # inputs
    input_snapshot = run_record.get("input_snapshot") or {}
    first = True
    for path, content in input_snapshot.items():
        label = "inputs" if first else ""
        lines.append(f"{label:<{W}}{path}  [{_h(content)}]  ({len(content):,} chars)")
        first = False

    # prompts / agents + template vars
    nodes_by_id = {n["id"]: n for n in workflow.get("nodes", [])}
    prompt_snapshot = run_record.get("prompt_snapshot") or {}
    for nid, prompt_text in prompt_snapshot.items():
        node = nodes_by_id.get(nid, {})
        cfg  = node.get("config", {})
        ntype = node.get("type", "prompt")
        if ntype == "agent":
            source = cfg.get("task_file") or "[inline task]"
            label  = "agent"
        else:
            source = cfg.get("prompt_file") or "[inline prompt]"
            label  = "prompt"
        lines.append(f"{label:<{W}}{source}  [{_h(prompt_text)}]")
        for var, val in (cfg.get("template_vars") or {}).items():
            lines.append(f"{'':<{W}}{var} = {val}")

    # outputs
    for path in (run_record.get("output_paths") or []):
        try:
            content = Path(path).read_text(encoding="utf-8")
            h = _h(content)
        except Exception:
            h = "?"
        lines.append(f"{'output':<{W}}{path}  [{h}]")

    return "\n".join(lines)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_workspace(wid: str) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM workspaces WHERE id = ?", (wid,)).fetchone()
    if not row:
        raise HTTPException(404, "Workspace not found")
    return dict(row)


def _save_run(record: dict):
    with get_db() as conn:
        conn.execute(
            """INSERT INTO runs
               (id, workflow_id, workspace_id, timestamp, duration_ms, status,
                input_snapshot, prompt_snapshot, output_content, model, token_count,
                node_outputs, git_commit_hash)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                record["id"],
                record["workflow_id"],
                record["workspace_id"],
                record["timestamp"],
                record["duration_ms"],
                record["status"],
                json.dumps(record["input_snapshot"]),
                json.dumps(record["prompt_snapshot"]),
                record["output_content"],
                record["model"],
                record["token_count"],
                json.dumps(record.get("node_outputs", {})),
                record.get("git_commit_hash"),
            ),
        )


# ── Git ───────────────────────────────────────────────────────────────────────

@app.get("/workspaces/{wid}/git/status")
def get_git_status(wid: str):
    ws = _get_workspace(wid)
    return git_bridge.git_status(Path(ws["path"]))


@app.get("/workspaces/{wid}/git/log")
def get_git_log(wid: str, n: int = 40):
    ws = _get_workspace(wid)
    return git_bridge.git_log(Path(ws["path"]), n)


@app.post("/workspaces/{wid}/git/init")
def init_git_repo(wid: str):
    ws = _get_workspace(wid)
    ok = git_bridge.git_init(Path(ws["path"]))
    if not ok:
        raise HTTPException(500, "git init failed")
    return {"ok": True}


class GitCommitBody(BaseModel):
    message: str


@app.post("/workspaces/{wid}/git/commit")
def manual_commit(wid: str, body: GitCommitBody):
    ws = _get_workspace(wid)
    h = git_bridge.auto_commit(Path(ws["path"]), body.message)
    return {"ok": bool(h), "hash": h}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=7799)
