"""Shared setup for the test scripts: Claude via AWS Bedrock, and Arize tracing."""

import os
import re
import sys
import threading
from pathlib import Path

from anthropic import AnthropicBedrock, Timeout

KEYS_FILE = Path(__file__).with_name("keys.txt")
# Accepts KEY=value, export KEY=value, set KEY=value, $Env:KEY="value", with or without quotes.
KEY_LINE = re.compile(r"^(?:export\s+|set\s+|\$env:)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*;?\s*$", re.IGNORECASE)


def load_keys():
    """Load keys.txt into the environment, so keys don't have to be typed into the terminal."""
    if not KEYS_FILE.exists():
        return
    for line in KEYS_FILE.read_text(encoding="utf-8-sig").splitlines():
        match = KEY_LINE.match(line.strip())
        if match and not line.strip().startswith("#"):
            name, value = match.group(1).upper(), match.group(2).strip("\"'")
            if value:
                os.environ[name] = value


load_keys()

# Each pipeline run keeps its files apart: PIPELINE_RUN=cheap uses work_cheap\ and outputs_cheap\.
RUN = os.environ.get("PIPELINE_RUN", "")
WORK_DIR = Path(__file__).with_name(f"work_{RUN}" if RUN else "work")
OUTPUTS_DIR = Path(__file__).with_name(f"outputs_{RUN}" if RUN else "outputs")

RECIPE_FILE = Path(__file__).with_name("report_recipe.txt")


def load_recipe():
    """Read report_recipe.txt: 'KEY: value' lines, then everything after 'OUTLINE:'."""
    recipe, lines = {}, RECIPE_FILE.read_text(encoding="utf-8-sig").splitlines()
    for i, line in enumerate(lines):
        if line.startswith("#") or ":" not in line:
            continue
        key, value = (part.strip() for part in line.split(":", 1))
        if key.upper() == "OUTLINE":
            recipe["outline"] = "\n".join(l for l in lines[i + 1:] if not l.startswith("#")).strip()
            break
        recipe[key.lower().replace(" ", "_")] = value
    recipe["comparison_files"] = [m.strip() for m in recipe.get("comparison_files", "").split(",") if m.strip()]
    return recipe


def set_properties(props, title):
    """Clean document properties for .pptx (core_properties) and .xlsx (wb.properties): the recipe's
    author/organization instead of library defaults like 'python-pptx' or 'openpyxl'."""
    recipe = load_recipe()
    author = recipe.get("author") or recipe.get("organization") or ""
    for attr, value in (("author", author), ("creator", author), ("last_modified_by", author),
                        ("lastModifiedBy", author), ("title", title), ("comments", ""), ("description", ""),
                        ("subject", ""), ("keywords", "")):
        if hasattr(props, attr):
            setattr(props, attr, value)
    if hasattr(props, "company"):
        props.company = recipe.get("organization", "")


def strip_image_metadata(path):
    """Remove embedded text chunks (e.g. 'Software: Matplotlib') from a PNG."""
    from PIL import Image
    with Image.open(path) as img:
        clean = Image.new(img.mode, img.size)
        clean.putdata(list(img.getdata()))
    clean.save(path)


# The event's AWS account serves Claude through cross-region inference profiles ("us." prefix).
# Model tiers: "smart" for storyline and hard judgment, "mid" for slide writing and editing,
# "cheap" for bulk reading and claim checks. Override any of them in keys.txt.
MODELS = {
    "smart": os.environ.get("BEDROCK_MODEL", "us.anthropic.claude-opus-5-5"),
    "mid": os.environ.get("BEDROCK_MODEL_MID", "us.anthropic.claude-sonnet-5-5"),
    # Haiku 5.5 (us.anthropic.claude-haiku-5-5) is 20x cheaper than Sonnet, but the event AWS account's marketplace
    # rules block it. Once your account allows it, add BEDROCK_MODEL_CHEAP=us.anthropic.claude-haiku-5-5 to keys.txt
    # (and test it first with test_haiku_reading.py).
    # Haiku 4.5 missed 18% of the numbers on scanned tables (work/model_test/), so the default is Sonnet 5.5.
    "cheap": os.environ.get("BEDROCK_MODEL_CHEAP", "us.anthropic.claude-sonnet-5-5"),
}
MODEL, MODEL_MID, MODEL_CHEAP = MODELS["smart"], MODELS["mid"], MODELS["cheap"]

# Approximate list prices, USD per million tokens: input, output, cache write, cache read
# (AWS Bedrock pricing may differ slightly). Haiku 5.5 costs 5x more for prompts over 100K tokens.
PRICES = {"opus": (4.00, 20.00, 5.00, 0.20), "sonnet": (2.00, 10.00, 2.50, 0.20),
          "haiku": (0.10, 0.50, 0.125, 0.01), "haiku-long": (0.50, 2.50, 0.625, 0.05),
          "haiku45": (1.00, 5.00, 1.25, 0.10)}
LONG_PROMPT = 100_000
BATCH_DISCOUNT = 0.5  # Bedrock batch inference bills half price


def price_key(model, prompt_tokens):
    if "haiku-4-5" in model:
        return "haiku45"
    for key in ("haiku", "sonnet", "opus"):
        if key in model:
            return "haiku-long" if key == "haiku" and prompt_tokens > LONG_PROMPT else key
    return "opus"


def effort_args(model, effort):
    """The effort setting as request arguments; Haiku 4.5 doesn't accept it."""
    return {} if "haiku-4-5" in model else {"output_config": {"effort": effort}}


class UsageMeter:
    """Adds up tokens and cost across all Claude calls (thread-safe), by model and by stage."""

    def __init__(self):
        self.lock = threading.Lock()
        self.calls = self.input = self.output = self.cache_write = self.cache_read = 0
        self.cost = 0.0
        self.by_model, self.by_stage = {}, {}
        self.stage = "main"

    def add(self, usage, model=None, batch=False):
        tokens = (usage.input_tokens or 0, usage.output_tokens or 0,
                  getattr(usage, "cache_creation_input_tokens", 0) or 0,
                  getattr(usage, "cache_read_input_tokens", 0) or 0)
        key = price_key(model or MODEL, tokens[0] + tokens[2] + tokens[3])
        cost = sum(t * p for t, p in zip(tokens, PRICES[key])) / 1e6 * (BATCH_DISCOUNT if batch else 1)
        with self.lock:
            self.calls += 1
            self.input += tokens[0]
            self.output += tokens[1]
            self.cache_write += tokens[2]
            self.cache_read += tokens[3]
            self.cost += cost
            for table, name in ((self.by_model, key.split("-")[0]), (self.by_stage, self.stage)):
                calls, total = table.get(name, (0, 0.0))
                table[name] = (calls + 1, total + cost)

    def breakdown(self):
        """One line per model and per stage, e.g. 'haiku 120 calls $0.41'."""
        fmt = lambda t: ", ".join(f"{k} {c} calls ${v:.2f}" for k, (c, v) in sorted(t.items(), key=lambda kv: -kv[1][1]))
        return f"By model: {fmt(self.by_model)}\nBy stage: {fmt(self.by_stage)}"

    def summary(self):
        return (f"Claude usage: {self.calls} calls, {self.input + self.cache_write + self.cache_read:,} tokens read "
                f"({self.cache_read:,} from cache), {self.output:,} tokens written. "
                f"Estimated cost: ${self.cost:.2f} (billed to your AWS account)")


USAGE = UsageMeter()
REGION = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "us-east-1"


def claude_client():
    """Claude on Bedrock. Picks up AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY /
    AWS_SESSION_TOKEN from the environment (or keys.txt)."""
    # The event account doesn't have the newer Mantle endpoint, so use bedrock-runtime.
    # A stalled connection gives up after 3 minutes without data (then the caller retries), instead of hanging.
    # Keys passed explicitly so a reloaded keys.txt (fresh temporary keys) takes effect in a running process.
    return AnthropicBedrock(aws_region=REGION, aws_access_key=os.environ.get("AWS_ACCESS_KEY_ID"),
                            aws_secret_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
                            aws_session_token=os.environ.get("AWS_SESSION_TOKEN"),
                            timeout=Timeout(900, read=180), max_retries=3)


def setup_tracing(project_name="hacksprint"):
    """Send every Claude call (and any spans we add) to Arize. Returns a tracer."""
    from arize.otel import register
    from openinference.instrumentation.anthropic import AnthropicInstrumentor

    missing = [k for k in ("ARIZE_SPACE_ID", "ARIZE_API_KEY") if not os.environ.get(k)]
    if missing:
        sys.exit(f"Set {' and '.join(missing)} first (Arize: Settings > API Keys).")

    tracer_provider = register(
        space_id=os.environ["ARIZE_SPACE_ID"],
        api_key=os.environ["ARIZE_API_KEY"],
        project_name=project_name,
        verbose=False,
    )
    AnthropicInstrumentor().instrument(tracer_provider=tracer_provider)
    return tracer_provider


def text_of(response):
    return "".join(block.text for block in response.content if block.type == "text")
