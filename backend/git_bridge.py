import subprocess
from pathlib import Path


def _git(args: list[str], cwd: Path) -> tuple[str, str, int]:
    r = subprocess.run(
        ["git"] + args,
        cwd=cwd, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    return r.stdout.strip(), r.stderr.strip(), r.returncode


def is_git_repo(path: Path) -> bool:
    _, _, rc = _git(["rev-parse", "--git-dir"], path)
    return rc == 0


def git_init(path: Path) -> bool:
    _, _, rc = _git(["init"], path)
    if rc != 0:
        return False
    # default identity so commits work without global config
    _git(["config", "user.email", "hexis@local"], path)
    _git(["config", "user.name", "Hexis"], path)
    # create sensible .gitignore if missing
    gi = path / ".gitignore"
    if not gi.exists():
        gi.write_text("__pycache__/\n*.pyc\n.env\n*.db\n", encoding="utf-8")
    return True


def git_status(path: Path) -> dict:
    if not is_git_repo(path):
        return {"is_repo": False, "branch": "", "clean": True, "staged": [], "unstaged": [], "untracked": []}

    branch, _, _ = _git(["rev-parse", "--abbrev-ref", "HEAD"], path)
    out, _, _ = _git(["status", "--porcelain"], path)

    staged, unstaged, untracked = [], [], []
    for line in out.splitlines():
        if len(line) < 4:
            continue
        x, y, fname = line[0], line[1], line[3:]
        if x not in (" ", "?"):
            staged.append(fname)
        if y in ("M", "D"):
            unstaged.append(fname)
        if x == "?" and y == "?":
            untracked.append(fname)

    return {
        "is_repo": True,
        "branch": branch or "main",
        "clean": not out.strip(),
        "staged": staged,
        "unstaged": unstaged,
        "untracked": untracked,
    }


def git_log(path: Path, n: int = 40) -> list[dict]:
    if not is_git_repo(path):
        return []
    fmt = "%H\x1f%h\x1f%s\x1f%ai\x1f%an"
    out, _, rc = _git(["log", f"-{n}", f"--pretty=format:{fmt}"], path)
    if rc != 0 or not out:
        return []
    commits = []
    for line in out.splitlines():
        parts = line.split("\x1f")
        if len(parts) >= 5:
            commits.append({
                "hash": parts[0],
                "short_hash": parts[1],
                "message": parts[2],
                "timestamp": parts[3],
                "author": parts[4],
            })
    return commits


def auto_commit(path: Path, message: str) -> str | None:
    """Stage everything and commit. Returns short hash or None."""
    if not is_git_repo(path):
        return None

    # ensure identity exists
    name, _, _ = _git(["config", "user.name"], path)
    if not name:
        _git(["config", "user.email", "hexis@local"], path)
        _git(["config", "user.name", "Hexis"], path)

    # remove .workflows/ from gitignore if it slipped in (migration for existing repos)
    gi = path / ".gitignore"
    if gi.exists():
        txt = gi.read_text(encoding="utf-8")
        if ".workflows/" in txt:
            gi.write_text(txt.replace(".workflows/\n", "").replace(".workflows/", ""), encoding="utf-8")

    _git(["add", "-A"], path)

    # nothing to commit?
    out, _, _ = _git(["status", "--porcelain"], path)
    if not out.strip():
        return None

    _, _, rc = _git(["commit", "-m", message, "--no-gpg-sign"], path)
    if rc != 0:
        return None

    h, _, _ = _git(["rev-parse", "--short", "HEAD"], path)
    return h or None
