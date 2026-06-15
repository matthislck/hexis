"""
Notion API helpers — page fetch (→ markdown) and page creation (markdown → blocks).
"""
import re
from notion_client import AsyncClient


def extract_page_id(url_or_id: str) -> str:
    """Extract 32-char hex ID from a Notion URL or bare ID."""
    clean = url_or_id.strip().replace("-", "")
    # find last 32-hex segment in URL
    matches = re.findall(r"[0-9a-f]{32}", clean.lower())
    if matches:
        raw = matches[-1]
        return f"{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:]}"
    raise ValueError(f"Cannot extract Notion page ID from: {url_or_id!r}")


def _rich_text_to_str(rich_text: list) -> str:
    return "".join(t.get("plain_text", "") for t in rich_text)


def _blocks_to_markdown(blocks: list) -> str:
    lines: list[str] = []
    for b in blocks:
        btype = b.get("type", "")
        data = b.get(btype, {})
        text = _rich_text_to_str(data.get("rich_text", []))

        if btype == "paragraph":
            lines.append(text or "")
        elif btype == "heading_1":
            lines.append(f"# {text}")
        elif btype == "heading_2":
            lines.append(f"## {text}")
        elif btype == "heading_3":
            lines.append(f"### {text}")
        elif btype == "bulleted_list_item":
            lines.append(f"- {text}")
        elif btype == "numbered_list_item":
            lines.append(f"1. {text}")
        elif btype == "to_do":
            checked = "x" if data.get("checked") else " "
            lines.append(f"- [{checked}] {text}")
        elif btype == "code":
            lang = data.get("language", "")
            lines.append(f"```{lang}\n{text}\n```")
        elif btype == "quote":
            lines.append(f"> {text}")
        elif btype == "callout":
            emoji = (data.get("icon") or {}).get("emoji", "")
            lines.append(f"> {emoji} {text}".strip())
        elif btype == "divider":
            lines.append("---")
        elif btype == "toggle":
            lines.append(f"**{text}**")
        elif btype == "image":
            url = (data.get("external") or data.get("file") or {}).get("url", "")
            caption = _rich_text_to_str(data.get("caption", []))
            lines.append(f"![{caption}]({url})")
        # skip unsupported types silently

    return "\n\n".join(l for l in lines)


async def search_pages(token: str, query: str = "") -> list[dict]:
    """Search Notion pages accessible to the integration. Returns [{id, title, url}]."""
    client = AsyncClient(auth=token)
    params: dict = {"filter": {"value": "page", "property": "object"}, "page_size": 20}
    if query:
        params["query"] = query
    resp = await client.search(**params)
    await client.aclose()

    results = []
    for item in resp.get("results", []):
        title = "Untitled"
        for prop in item.get("properties", {}).values():
            if prop.get("type") == "title":
                t = _rich_text_to_str(prop.get("title", []))
                if t:
                    title = t
                break
        results.append({
            "id": item["id"],
            "title": title,
            "url": item.get("url", ""),
        })
    return results


async def fetch_page(token: str, page_url: str) -> tuple[str, str]:
    """Returns (title, markdown_content)."""
    page_id = extract_page_id(page_url)
    client = AsyncClient(auth=token)

    page = await client.pages.retrieve(page_id=page_id)

    # extract title from properties
    title = "Untitled"
    for prop in page.get("properties", {}).values():
        if prop.get("type") == "title":
            title = _rich_text_to_str(prop.get("title", [])) or "Untitled"
            break

    # fetch all block children (paginated)
    blocks: list = []
    cursor = None
    while True:
        kwargs: dict = {"block_id": page_id}
        if cursor:
            kwargs["start_cursor"] = cursor
        resp = await client.blocks.children.list(**kwargs)
        blocks.extend(resp["results"])
        if not resp.get("has_more"):
            break
        cursor = resp["next_cursor"]

    await client.aclose()
    return title, _blocks_to_markdown(blocks)


def _markdown_to_blocks(markdown: str) -> list:
    """Convert markdown text to Notion block objects."""
    blocks = []
    for line in markdown.splitlines():
        if line.startswith("# "):
            blocks.append(_heading(1, line[2:]))
        elif line.startswith("## "):
            blocks.append(_heading(2, line[3:]))
        elif line.startswith("### "):
            blocks.append(_heading(3, line[4:]))
        elif line.startswith("- [ ] ") or line.startswith("- [x] "):
            checked = line[3] == "x"
            blocks.append(_todo(line[6:], checked))
        elif line.startswith("- ") or line.startswith("* "):
            blocks.append(_bullet(line[2:]))
        elif re.match(r"^\d+\. ", line):
            blocks.append(_numbered(re.sub(r"^\d+\. ", "", line)))
        elif line.startswith("> "):
            blocks.append(_quote(line[2:]))
        elif line == "---":
            blocks.append({"object": "block", "type": "divider", "divider": {}})
        else:
            blocks.append(_paragraph(line))

    # Notion API limit: 100 blocks per request — chunk if needed
    return blocks


def _rt(text: str) -> list:
    return [{"type": "text", "text": {"content": text}}]


def _paragraph(text: str) -> dict:
    return {"object": "block", "type": "paragraph", "paragraph": {"rich_text": _rt(text)}}


def _heading(level: int, text: str) -> dict:
    key = f"heading_{level}"
    return {"object": "block", "type": key, key: {"rich_text": _rt(text)}}


def _bullet(text: str) -> dict:
    return {"object": "block", "type": "bulleted_list_item",
            "bulleted_list_item": {"rich_text": _rt(text)}}


def _numbered(text: str) -> dict:
    return {"object": "block", "type": "numbered_list_item",
            "numbered_list_item": {"rich_text": _rt(text)}}


def _quote(text: str) -> dict:
    return {"object": "block", "type": "quote", "quote": {"rich_text": _rt(text)}}


def _todo(text: str, checked: bool) -> dict:
    return {"object": "block", "type": "to_do",
            "to_do": {"rich_text": _rt(text), "checked": checked}}


async def create_page(token: str, database_url: str, title: str, markdown: str) -> str:
    """Create a new page inside a Notion database or page. Returns the new page URL."""
    parent_id = extract_page_id(database_url)
    client = AsyncClient(auth=token)

    blocks = _markdown_to_blocks(markdown)

    # Notion allows max 100 children per create call
    first_batch = blocks[:100]
    rest = blocks[100:]

    # Try as a database first; if the ID belongs to a plain page, fall back to page_id parent.
    try:
        page = await client.pages.create(
            parent={"database_id": parent_id},
            properties={"title": {"title": _rt(title)}},
            children=first_batch,
        )
    except Exception as exc:
        msg = str(exc).lower()
        if "not a database" in msg or "validation_error" in msg:
            try:
                page = await client.pages.create(
                    parent={"page_id": parent_id},
                    properties={"title": {"title": _rt(title)}},
                    children=first_batch,
                )
            except Exception:
                await client.aclose()
                raise
        else:
            await client.aclose()
            raise

    page_id = page["id"]

    # append remaining blocks in chunks of 100
    for i in range(0, len(rest), 100):
        await client.blocks.children.append(
            block_id=page_id,
            children=rest[i:i + 100],
        )

    await client.aclose()
    return f"https://notion.so/{page_id.replace('-', '')}"
