"""Bedrock developer: Claude on AWS Bedrock writes and tests code inside a Daytona sandbox.

    .venv\\Scripts\\python.exe bedrock_dev.py TASK.md --upload <files/folders...> --allow <folders...> [--budget 20]

1. The listed files and folders are copied into a disposable Daytona sandbox (PDFs and images skipped).
2. Opus on Bedrock works like a developer there: reads code, writes files, runs commands and tests.
   (The sandbox can install packages from PyPI but cannot call Bedrock, so code that calls Claude is
   written but only unit-tested with stubs.)
3. Files it created or changed under the --allow folders are copied back to this laptop. Local originals are
   backed up to work/bedrock_dev/<run>/backup first. Nothing outside --allow is ever written locally.
A report with the summary, changed files and cost goes to work/bedrock_dev/<run>/REPORT.md.
"""

import argparse
import hashlib
import json
import shutil
import sys
import time
from pathlib import Path

from daytona import CreateSandboxFromSnapshotParams, Daytona, FileUpload

from common import MODELS, USAGE, claude_client, effort_args, load_keys, text_of

HERE = Path(__file__).parent
REMOTE = "/home/daytona/proj"
SKIP_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".mp4", ".pyc", ".zip", ".rar"}
SKIP_DIRS = {".venv", "__pycache__", ".git", "png", "frames", "pages", "node_modules"}
MAX_FILE, MAX_TOTAL = 30_000_000, 150_000_000
PACKAGES = "anthropic daytona pymupdf python-pptx openpyxl lxml pillow pytest markdown"

SYSTEM = """You are a senior Python engineer working in a Linux sandbox on a copy of a project ({remote}).
Environment: Python 3 with these packages installed: {packages}. The sandbox can reach PyPI but NOT AWS Bedrock or
other websites, so never run code paths that call Claude; test them with stubs or test the pure functions.
Paths in the code that point to Windows folders (C:\\...) don't exist here; keep them in the code but make your
tests use the project's own data files.
Rules:
- Only create or change files inside these folders: {allow}. Everything else is read-only reference.
- Match the existing code's style, naming and comment density. Keep changes focused; reuse existing helpers.
- Write tests (pytest) for what you build, inside an allowed folder, and run them until they pass.
- Work efficiently: read only what you need (use list_dir, read_file with line ranges, run with grep).
- When done, call finish with: what you built, how to run it (Windows commands from the project root, using
  .venv\\Scripts\\python.exe), test results, anything untested (e.g. steps that call Claude), and open questions."""

TOOLS = [
    {"name": "list_dir", "description": "List files under a project folder (recursive, max 300).",
     "input_schema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}},
    {"name": "read_file", "description": "Read a file with line numbers; optional line range.",
     "input_schema": {"type": "object", "properties": {"path": {"type": "string"}, "start": {"type": "integer"},
                                                       "end": {"type": "integer"}}, "required": ["path"]}},
    {"name": "write_file", "description": "Create or overwrite a file (allowed folders only).",
     "input_schema": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}},
                      "required": ["path", "content"]}},
    {"name": "replace_in_file", "description": "Replace one exact, unique snippet in a file (allowed folders only).",
     "input_schema": {"type": "object", "properties": {"path": {"type": "string"}, "old": {"type": "string"},
                                                       "new": {"type": "string"}}, "required": ["path", "old", "new"]}},
    {"name": "run", "description": "Run a shell command in the project folder (e.g. pytest, python, grep). Output is truncated.",
     "input_schema": {"type": "object", "properties": {"command": {"type": "string"}, "timeout": {"type": "integer"}},
                      "required": ["command"]}},
    {"name": "view_image", "description": "Look at an image file (PNG/JPEG, e.g. a screenshot you took) yourself.",
     "input_schema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}},
    {"name": "finish", "description": "End the work with a summary for the human.",
     "input_schema": {"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"]}},
]


def local_files(paths):
    for p in paths:
        p = (HERE / p).resolve()
        items = [p] if p.is_file() else (x for x in p.rglob("*") if x.is_file()) if p.is_dir() else []
        for f in items:
            rel = f.relative_to(HERE)
            if f.suffix.lower() in SKIP_SUFFIXES or set(rel.parts) & SKIP_DIRS or f.stat().st_size > MAX_FILE:
                continue
            yield rel


def wait_for_new_keys(hours=3):
    """Poll keys.txt until it changes (the user pastes fresh AWS keys), then reload it and return a new client."""
    keys = HERE / "keys.txt"
    seen = keys.stat().st_mtime
    print("  AWS keys expired: paste new ones into keys.txt and save; waiting ...", flush=True)
    for _ in range(int(hours * 60)):
        time.sleep(60)
        if keys.stat().st_mtime != seen:
            load_keys()
            print("  new keys loaded; continuing", flush=True)
            return claude_client()
    raise RuntimeError("no new AWS keys within the wait")


def sha1(data):
    return hashlib.sha1(data).hexdigest()


class Dev:
    def __init__(self, sandbox, allow):
        self.sb, self.allow = sandbox, [a.strip("/\\").replace("\\", "/") for a in allow]

    def allowed(self, path):
        p = path.strip("/").replace("\\", "/")
        return any(p == a or p.startswith(a + "/") for a in self.allow) and ".." not in p

    def tool(self, name, i):
        if name == "list_dir":
            r = self.sb.process.exec(f"find {i['path'] or '.'} -type f -not -path '*/__pycache__/*' | head -300", cwd=REMOTE)
            return r.result
        if name == "read_file":
            s, e = i.get("start") or 1, i.get("end") or (i.get("start") or 1) + 399
            r = self.sb.process.exec(f"awk 'NR>={s} && NR<={min(e, s + 599)} {{printf \"%d\\t%s\\n\", NR, $0}}' {json.dumps(i['path'])}", cwd=REMOTE)
            return r.result or "(empty or missing)"
        if name in ("write_file", "replace_in_file"):
            if not self.allowed(i["path"]):
                return f"Refused: {i['path']} is outside the allowed folders {self.allow}."
            path = f"{REMOTE}/{i['path']}"
            if name == "replace_in_file":
                text = self.sb.fs.download_file(path).decode("utf-8")
                if text.count(i["old"]) != 1:
                    return f"Refused: the snippet occurs {text.count(i['old'])} times (must be exactly once)."
                content = text.replace(i["old"], i["new"])
            else:
                content = i["content"]
            self.sb.process.exec(f"mkdir -p $(dirname {json.dumps(path)})")
            self.sb.fs.upload_file(content.encode("utf-8"), path)
            return f"Saved {i['path']} ({len(content.splitlines())} lines)."
        if name == "view_image":
            import base64
            path = i["path"] if i["path"].startswith("/") else f"{REMOTE}/{i['path']}"
            data = self.sb.fs.download_file(path)
            if len(data) > 3_500_000:
                return "Image too large (over 3.5 MB); take a smaller screenshot (e.g. JPEG or a clip)."
            kind = "image/jpeg" if data[:3] == b"\xff\xd8\xff" else "image/png"
            return [{"type": "image", "source": {"type": "base64", "media_type": kind,
                                                 "data": base64.b64encode(data).decode()}}]
        if name == "run":
            r = self.sb.process.exec(i["command"] + " 2>&1", cwd=REMOTE, timeout=min(i.get("timeout") or 300, 900))
            out = r.result or ""
            return f"exit {r.exit_code}\n" + (out[-8000:] if len(out) > 8000 else out)
        return "Unknown tool."


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("task")
    ap.add_argument("--upload", nargs="+", required=True)
    ap.add_argument("--allow", nargs="+", required=True)
    ap.add_argument("--budget", type=float, default=20.0)
    ap.add_argument("--steps", type=int, default=90)
    args = ap.parse_args()
    run_dir = HERE / "work" / "bedrock_dev" / time.strftime("%Y%m%d_%H%M%S")
    run_dir.mkdir(parents=True, exist_ok=True)
    task = Path(args.task).read_text(encoding="utf-8")
    model = MODELS["smart"]

    sandbox = Daytona().create(CreateSandboxFromSnapshotParams(language="python", ephemeral=True, auto_stop_interval=240,
                                                               labels={"created-by": "bedrock-dev"}))
    try:
        uploads, manifest, total = [], {}, 0
        for rel in sorted(set(local_files(args.upload))):
            data = (HERE / rel).read_bytes()
            total += len(data)
            if total > MAX_TOTAL:
                print("upload limit reached; skipping the rest", flush=True)
                break
            uploads.append(FileUpload(source=data, destination=f"{REMOTE}/{rel.as_posix()}"))
            manifest[rel.as_posix()] = sha1(data)
        sandbox.process.exec(f"mkdir -p {REMOTE}")
        for i in range(0, len(uploads), 200):
            sandbox.fs.upload_files(uploads[i:i + 200])
        print(f"uploaded {len(uploads)} files ({total / 1e6:.1f} MB); installing packages ...", flush=True)
        sandbox.process.exec(f"pip install -q {PACKAGES}", timeout=900)

        dev, client = Dev(sandbox, args.allow), claude_client()
        system = SYSTEM.format(remote=REMOTE, packages=PACKAGES, allow=", ".join(dev.allow))
        messages = [{"role": "user", "content": f"Task:\n\n{task}"}]
        summary = "(no summary)"
        for step in range(1, args.steps + 1):
            if USAGE.cost > args.budget or step == args.steps:
                messages.append({"role": "user", "content": "Budget or step limit reached: call finish now."})
            r = None
            for attempt in range(5):  # dropped connections and Bedrock hiccups: retry instead of losing the sandbox
                try:
                    with client.messages.stream(model=model, max_tokens=32000, system=system, tools=TOOLS,
                                                messages=messages, **effort_args(model, "medium"),
                                                cache_control={"type": "ephemeral"}) as st:
                        r = st.get_final_message()
                    break
                except Exception as e:
                    print(f"  step {step}: model call failed ({type(e).__name__}: {str(e)[:120]}); retry {attempt + 1}",
                          flush=True)
                    if "expired" in str(e).lower():  # temporary AWS keys ran out: wait for new ones in keys.txt
                        client = wait_for_new_keys()
                    else:
                        time.sleep(20 * (attempt + 1))
            if r is None:
                summary = "(stopped early: the model call kept failing; files written so far were kept)"
                break
            USAGE.add(r.usage, model)
            messages.append({"role": "assistant", "content": r.content})
            calls = [b for b in r.content if b.type == "tool_use"]
            if not calls:
                summary = text_of(r)
                break
            results, finished = [], False
            for b in calls:
                if b.name == "finish":
                    summary, finished = b.input.get("summary", ""), True
                    results.append({"type": "tool_result", "tool_use_id": b.id, "content": "ok"})
                    continue
                try:
                    out = dev.tool(b.name, b.input)
                except Exception as e:
                    out = f"Error: {type(e).__name__}: {e}"
                label = b.input.get("path") or b.input.get("command") or ""
                print(f"  step {step} ${USAGE.cost:.2f}: {b.name} {str(label)[:100]}", flush=True)
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": out})
            messages.append({"role": "user", "content": results})
            if finished:
                break

        # Bring back new or changed files from the allowed folders only.
        allow = json.dumps(dev.allow).replace('"', "'")
        listing = sandbox.process.exec(
            "python3 -c \"import hashlib,json,os;h=lambda p:hashlib.sha1(open(p,'rb').read()).hexdigest();"
            "print(json.dumps({**{os.path.relpath(os.path.join(d,f),'.'): h(os.path.join(d,f)) for a in " + allow +
            " if os.path.isdir(a) for d,_,fs in os.walk(a) if '__pycache__' not in d for f in fs}, "
            "**{a: h(a) for a in " + allow + " if os.path.isfile(a)}}))\"", cwd=REMOTE)
        remote = json.loads(listing.result.strip().splitlines()[-1])
        changed = [p for p, h in remote.items()
                   if manifest.get(p) != h and dev.allowed(p) and ".pytest_cache" not in p]
        for p in changed:
            dest = HERE / p
            if dest.exists():
                backup = run_dir / "backup" / p
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dest, backup)
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(sandbox.fs.download_file(f"{REMOTE}/{p}"))
    finally:
        sandbox.delete()

    report = (f"# Bedrock developer run\n\nTask: {args.task}\n\n## Summary\n{summary}\n\n## Files changed or created "
              f"({len(changed)})\n" + "\n".join(f"- {p}" for p in sorted(changed)) +
              f"\n\nOriginals backed up in {run_dir / 'backup'}\n\n## Cost\n{USAGE.summary()}\n")
    (run_dir / "REPORT.md").write_text(report, encoding="utf-8")
    print(f"\nDone. {len(changed)} files changed. {USAGE.summary()}\nReport: {run_dir / 'REPORT.md'}", flush=True)


if __name__ == "__main__":
    main()
