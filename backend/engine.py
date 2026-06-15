import asyncio
import json
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncGenerator

from notion_bridge import fetch_page, create_page
from models import get_db


async def execute_workflow(
    workflow: dict,
    workspace_path: Path,
    staleness: dict[str, str] | None = None,
    cached_outputs: dict[str, str] | None = None,
    notion_token: str | None = None,
    anthropic_key: str | None = None,
    openai_key: str | None = None,
    gemini_key: str | None = None,
) -> AsyncGenerator[str, None]:
    """Topological execution of a workflow, yielding SSE-formatted strings."""
    nodes = {n["id"]: n for n in workflow["nodes"]}
    edges = workflow["edges"]

    # build adjacency + in-degree for Kahn's algorithm
    children: dict[str, list[str]] = {n: [] for n in nodes}
    in_degree: dict[str, int] = {n: 0 for n in nodes}
    for e in edges:
        children[e["source"]].append(e["target"])
        in_degree[e["target"]] += 1

    queue = [n for n, d in in_degree.items() if d == 0]
    order: list[str] = []
    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for child in children[nid]:
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

    context: dict[str, str] = {}
    input_snapshot: dict[str, str] = {}
    prompt_snapshot: dict[str, str] = {}
    node_outputs: dict[str, str] = {}
    output_paths: list[str] = []
    output_content = ""
    model_used = ""
    token_count = 0
    start_ms = int(time.time() * 1000)
    skipped: list[str] = []

    for nid in order:
        node = nodes[nid]
        ntype = node["type"]
        cfg = node.get("config", {})

        # skip fresh nodes — reuse cached output
        node_staleness = (staleness or {}).get(nid, "stale")
        if node_staleness == "fresh" and cached_outputs and nid in cached_outputs:
            context[nid] = cached_outputs[nid]
            node_outputs[nid] = cached_outputs[nid]
            skipped.append(nid)
            yield _sse("skip", nid)
            continue

        yield _sse("node_start", nid)

        if ntype == "input":
            parts = []
            for p in cfg.get("paths", []):
                full = workspace_path / p
                if full.is_dir():
                    for f in sorted(full.rglob("*.md")):
                        content = f.read_text(encoding="utf-8")
                        parts.append(f"### {f.name}\n\n{content}")
                        input_snapshot[str(f.relative_to(workspace_path))] = content
                elif full.is_file():
                    content = full.read_text(encoding="utf-8")
                    parts.append(content)
                    input_snapshot[p] = content
                else:
                    yield _sse("warning", f"File not found: {p}")
            context[nid] = "\n\n".join(parts)
            node_outputs[nid] = context[nid]
            yield _sse("status", f"Input node {nid}: read {len(parts)} file(s)")

        elif ntype == "prompt":
            incoming_ids = [e["source"] for e in edges if e["target"] == nid]
            incoming_text = "\n\n".join(context.get(src, "") for src in incoming_ids)

            if cfg.get("prompt_source") == "file" and cfg.get("prompt_file"):
                try:
                    prompt_text = (workspace_path / cfg["prompt_file"]).read_text(encoding="utf-8")
                except Exception:
                    yield _sse("error", f"Cannot read prompt file: {cfg['prompt_file']}")
                    return
            else:
                prompt_text = cfg.get("prompt", "")

            if "{{input}}" in prompt_text or "{{previous_output}}" in prompt_text:
                prompt_text = prompt_text.replace("{{input}}", incoming_text)
                prompt_text = prompt_text.replace("{{previous_output}}", incoming_text)
            elif incoming_text:
                prompt_text = prompt_text + "\n\n<document>\n" + incoming_text + "\n</document>"
            for var_name, var_value in cfg.get("template_vars", {}).items():
                prompt_text = prompt_text.replace("{{" + var_name + "}}", str(var_value))
            prompt_snapshot[nid] = prompt_text
            model_used = cfg.get("model", "claude-sonnet-4-6")
            backend = cfg.get("backend", "claude-cli")

            yield _sse("status", f"Prompt node {nid}: {backend} / {model_used}…")

            result_text = ""
            try:
                if backend == "claude-cli":
                    async for chunk, tokens, _ in _run_claude_cli(prompt_text, model_used, workspace_path):
                        result_text += chunk
                        token_count += tokens
                        if chunk:
                            yield _sse("chunk", chunk)
                elif backend == "anthropic-api":
                    if not anthropic_key:
                        yield _sse("error", "Anthropic API key not set — add it in workspace settings")
                        return
                    async for chunk, tokens in _run_anthropic_api(prompt_text, model_used, anthropic_key):
                        result_text += chunk
                        token_count += tokens
                        if chunk:
                            yield _sse("chunk", chunk)
                elif backend == "openai-api":
                    if not openai_key:
                        yield _sse("error", "OpenAI API key not set — add it in workspace settings")
                        return
                    async for chunk, tokens in _run_openai_api(prompt_text, model_used, openai_key):
                        result_text += chunk
                        token_count += tokens
                        if chunk:
                            yield _sse("chunk", chunk)
                elif backend == "gemini-api":
                    if not gemini_key:
                        yield _sse("error", "Gemini API key not set — add it in workspace settings")
                        return
                    async for chunk, tokens in _run_gemini_api(prompt_text, model_used, gemini_key):
                        result_text += chunk
                        token_count += tokens
                        if chunk:
                            yield _sse("chunk", chunk)
                elif backend == "codex-cli":
                    async for chunk, tokens in _run_codex_cli(prompt_text, model_used, workspace_path):
                        result_text += chunk
                        token_count += tokens
                        if chunk:
                            yield _sse("chunk", chunk)
                else:
                    yield _sse("error", f"Unknown backend: {backend!r}")
                    return
            except Exception as exc:
                yield _sse("error", f"{backend} error: {exc}")
                return

            context[nid] = result_text
            node_outputs[nid] = result_text

        elif ntype == "agent":
            incoming_ids = [e["source"] for e in edges if e["target"] == nid]
            incoming_text = "\n\n".join(context.get(src, "") for src in incoming_ids)

            if cfg.get("task_source") == "file" and cfg.get("task_file"):
                try:
                    task_text = (workspace_path / cfg["task_file"]).read_text(encoding="utf-8")
                except Exception:
                    yield _sse("error", f"Cannot read task file: {cfg['task_file']}")
                    return
            else:
                task_text = cfg.get("task", "")

            if "{{input}}" in task_text or "{{previous_output}}" in task_text:
                task_text = task_text.replace("{{input}}", incoming_text)
                task_text = task_text.replace("{{previous_output}}", incoming_text)
            elif incoming_text:
                task_text = task_text + "\n\n<document>\n" + incoming_text + "\n</document>"
            for var_name, var_value in cfg.get("template_vars", {}).items():
                task_text = task_text.replace("{{" + var_name + "}}", str(var_value))

            prompt_snapshot[nid] = task_text
            model_used = cfg.get("model", "claude-sonnet-4-6")
            agent_system_prompt = cfg.get("agent_system_prompt") or None
            yield _sse("status", f"Agent {nid}: running task with {model_used}…")

            result_text = ""
            try:
                async for chunk, tokens, is_meta in _run_claude_cli(task_text, model_used, workspace_path, agent_system_prompt):
                    token_count += tokens
                    if not chunk:
                        continue
                    if is_meta:
                        # tool-call traces go to status panel, not into the output file
                        yield _sse("status", chunk.strip())
                    else:
                        result_text += chunk
                        yield _sse("chunk", chunk)
            except Exception as exc:
                yield _sse("error", f"Agent error: {exc}")
                return

            context[nid] = result_text
            node_outputs[nid] = result_text

        elif ntype == "output":
            incoming_ids = [e["source"] for e in edges if e["target"] == nid]
            if not incoming_ids:
                yield _sse("warning", f"Output node {nid} has no incoming connection — output will be empty")
            output_content = "\n\n".join(context.get(src, "") for src in incoming_ids)
            ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
            fname_raw = (cfg.get("output_filename") or cfg.get("filename") or f"{ts}.md").replace("{{timestamp}}", ts)
            folder = cfg.get("output_folder") or ""
            if folder:
                out_path = workspace_path / folder / Path(fname_raw).name
            elif "/" in fname_raw or "\\" in fname_raw:
                # filename contains a path — treat as workspace-relative
                out_path = workspace_path / fname_raw
            else:
                wf_slug = re.sub(r"[^a-z0-9]+", "-", workflow.get("name", "output").lower()).strip("-")
                out_path = workspace_path / "outputs" / wf_slug / fname_raw
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(output_content, encoding="utf-8")
            output_paths.append(str(out_path))
            context[nid] = output_content
            node_outputs[nid] = output_content
            yield _sse("status", f"Output written to {out_path}")

        elif ntype == "notion-input":
            if not notion_token:
                yield _sse("error", "Notion API token not set — add it in workspace settings")
                return
            page_url = cfg.get("page_url", "")
            if not page_url:
                yield _sse("warning", f"Notion input node {nid}: no page URL configured")
                context[nid] = ""
                node_outputs[nid] = ""
                continue
            yield _sse("status", f"Fetching Notion page…")
            try:
                title, content = await fetch_page(notion_token, page_url)
                context[nid] = f"# {title}\n\n{content}"
                node_outputs[nid] = context[nid]
                input_snapshot[page_url] = context[nid]
                yield _sse("status", f'Notion: fetched "{title}"')
            except Exception as e:
                yield _sse("error", f"Notion fetch failed: {e}")
                return

        elif ntype == "notion-output":
            if not notion_token:
                yield _sse("error", "Notion API token not set — add it in workspace settings")
                return
            database_url = cfg.get("database_url", "")
            if not database_url:
                yield _sse("warning", f"Notion output node {nid}: no database URL configured")
                continue
            incoming_ids = [e["source"] for e in edges if e["target"] == nid]
            output_content = "\n\n".join(context.get(src, "") for src in incoming_ids)
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
            title_tpl = cfg.get("title_template", "Hexis output {{timestamp}}")
            page_title = title_tpl.replace("{{timestamp}}", ts)
            yield _sse("status", f"Creating Notion page for {page_title}...")
            try:
                page_url = await create_page(notion_token, database_url, page_title, output_content)
                context[nid] = output_content
                node_outputs[nid] = output_content
                yield _sse("status", f"Notion: page created → {page_url}")
            except Exception as e:
                yield _sse("error", f"Notion create failed: {e}")
                return

        elif ntype == "workflow-ref":
            ref_wf_id = cfg.get("ref_workflow_id", "")
            ref_wf_name = cfg.get("ref_workflow_name", ref_wf_id)
            if not ref_wf_id:
                yield _sse("warning", f"Workflow-ref node {nid}: no workflow configured")
                context[nid] = ""
                node_outputs[nid] = ""
                continue
            workspace_id = workflow.get("workspace_id", "")
            yield _sse("status", f"Loading latest output of workflow '{ref_wf_name}'…")
            try:
                with get_db() as conn:
                    row = conn.execute(
                        "SELECT output_content FROM runs WHERE workspace_id = ? AND workflow_id = ? "
                        "ORDER BY timestamp DESC LIMIT 1",
                        (workspace_id, ref_wf_id),
                    ).fetchone()
                if row and row["output_content"]:
                    context[nid] = row["output_content"]
                    node_outputs[nid] = row["output_content"]
                    preview = row["output_content"][:80].replace("\n", " ")
                    yield _sse("status", f"Loaded {len(row['output_content'])} chars from '{ref_wf_name}': {preview}…")
                else:
                    yield _sse("warning", f"No previous run found for workflow '{ref_wf_name}' — node will be empty")
                    context[nid] = ""
                    node_outputs[nid] = ""
            except Exception as e:
                yield _sse("error", f"Workflow-ref lookup failed: {e}")
                return

    duration_ms = int(time.time() * 1000) - start_ms
    run_record = {
        "id": str(uuid.uuid4()),
        "workflow_id": workflow["id"],
        "workspace_id": workflow.get("workspace_id", ""),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "duration_ms": duration_ms,
        "status": "success",
        "input_snapshot": input_snapshot,
        "prompt_snapshot": prompt_snapshot,
        "output_content": output_content,
        "model": model_used,
        "token_count": token_count,
        "node_outputs": node_outputs,
        "output_paths": output_paths,
        "skipped_nodes": skipped,
    }
    yield _sse("done", json.dumps(run_record))


async def _run_claude_cli(prompt: str, model: str, cwd: Path | None = None, system_prompt: str | None = None):
    """
    Calls `claude -p <prompt> --model <model> --output-format stream-json`
    and yields (text_chunk, token_delta, is_meta) tuples.

    is_meta=True for tool-call traces (meant for status display only).
    is_meta=False for actual model text output (goes into result files).
    """
    cmd = [
        "claude",
        "--print",
        "--verbose",
        "--dangerously-skip-permissions",
        "--model", model,
        "--output-format", "stream-json",
    ]
    if system_prompt:
        cmd += ["--system-prompt", system_prompt]
    cmd.append(prompt)
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
    )

    assert proc.stdout is not None

    async for raw_line in proc.stdout:
        line = raw_line.decode("utf-8", errors="replace").strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            yield line, 0, True  # non-JSON debug lines are meta
            continue

        etype = event.get("type", "")

        if etype == "assistant":
            for block in event.get("message", {}).get("content", []):
                btype = block.get("type", "")
                if btype == "text":
                    yield block["text"], 0, False
                elif btype == "tool_use":
                    tool_name = block.get("name", "?")
                    tool_input = block.get("input", {})
                    line_out = _format_tool_call(tool_name, tool_input)
                    yield line_out, 0, True

        elif etype == "tool":
            for result in event.get("content", []):
                if result.get("type") == "tool_result":
                    content = result.get("content", "")
                    if isinstance(content, list):
                        content = " ".join(c.get("text", "") for c in content if c.get("type") == "text")
                    preview = str(content)[:120].replace("\n", " ").strip()
                    if preview:
                        yield f"  ↳ {preview}\n", 0, True

        elif etype == "result":
            usage = event.get("usage", {})
            total = usage.get("input_tokens", 0) + usage.get("output_tokens", 0)
            yield "", total, True

    await proc.wait()
    if proc.returncode != 0:
        stderr = await proc.stderr.read() if proc.stderr else b""
        raise RuntimeError(f"claude CLI exited {proc.returncode}: {stderr.decode()[:300]}")


def _format_tool_call(name: str, inp: dict) -> str:
    """Format a Claude Code tool call as a readable one-liner."""
    if name == "bash":
        cmd = inp.get("command", "").strip()
        short = cmd[:80].replace("\n", "; ")
        return f"\n▸ bash: {short}\n"
    if name in ("write_file", "create_file"):
        path = inp.get("file_path", inp.get("path", "?"))
        return f"\n▸ write: {path}\n"
    if name == "read_file":
        path = inp.get("file_path", inp.get("path", "?"))
        return f"\n▸ read: {path}\n"
    if name == "edit_file":
        path = inp.get("file_path", inp.get("path", "?"))
        return f"\n▸ edit: {path}\n"
    if name == "list_directory":
        path = inp.get("path", ".")
        return f"\n▸ ls: {path}\n"
    if name == "search_files":
        pattern = inp.get("pattern", inp.get("query", "?"))
        return f"\n▸ search: {pattern}\n"
    # generic fallback
    args = ", ".join(f"{k}={str(v)[:40]}" for k, v in list(inp.items())[:3])
    return f"\n▸ {name}({args})\n"


async def _run_anthropic_api(prompt: str, model: str, api_key: str):
    """Calls Anthropic API with streaming, yields (text_chunk, token_delta)."""
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=api_key)
    async with client.messages.stream(
        model=model,
        max_tokens=8096,
        messages=[{"role": "user", "content": prompt}],
    ) as stream:
        async for text in stream.text_stream:
            yield text, 0
        msg = await stream.get_final_message()
        total = msg.usage.input_tokens + msg.usage.output_tokens
        yield "", total
    await client.aclose()


async def _run_openai_api(prompt: str, model: str, api_key: str):
    """Calls OpenAI API with streaming, yields (text_chunk, token_delta)."""
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=api_key)

    # o-series reasoning models don't support streaming — use non-streaming
    is_reasoning = model.startswith("o1") or model.startswith("o3") or model.startswith("o4")
    if is_reasoning:
        resp = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.choices[0].message.content or ""
        usage = resp.usage
        total = (usage.prompt_tokens + usage.completion_tokens) if usage else 0
        yield text, total
    else:
        total_tokens = 0
        stream = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
            stream_options={"include_usage": True},
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield delta, 0
            if chunk.usage:
                total_tokens = chunk.usage.prompt_tokens + chunk.usage.completion_tokens
        yield "", total_tokens
    await client.close()


async def _run_gemini_api(prompt: str, model: str, api_key: str):
    """Calls Google Gemini API with streaming, yields (text_chunk, token_delta)."""
    from google import genai
    client = genai.Client(api_key=api_key)
    total_tokens = 0
    async for chunk in await client.aio.models.generate_content_stream(
        model=model,
        contents=prompt,
    ):
        if chunk.text:
            yield chunk.text, 0
        if chunk.usage_metadata:
            total_tokens = (chunk.usage_metadata.prompt_token_count or 0) + (chunk.usage_metadata.candidates_token_count or 0)
    yield "", total_tokens


async def _run_codex_cli(prompt: str, model: str, cwd: Path | None = None):
    """Calls OpenAI Codex CLI, yields (text_chunk, token_delta)."""
    cmd = ["codex", "--quiet", "--model", model, prompt] if model and model != "codex" else ["codex", "--quiet", prompt]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=cwd,
    )
    assert proc.stdout is not None
    async for raw_line in proc.stdout:
        line = raw_line.decode("utf-8", errors="replace")
        if line.strip():
            yield line, 0
    await proc.wait()
    if proc.returncode != 0:
        stderr = await proc.stderr.read() if proc.stderr else b""
        raise RuntimeError(f"codex CLI exited {proc.returncode}: {stderr.decode()[:300]}")


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"
