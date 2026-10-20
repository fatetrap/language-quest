"""Tests for build_db.py: the shared lesson DB (course/db) built from course/outline.json + course/lessons.

Run from the project root:  python -m pytest course_tests -q
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import build_db  # noqa: E402

OUTLINE = json.loads(build_db.OUTLINE_FILE.read_text(encoding="utf-8"))
DATA = build_db.load_lessons(OUTLINE)
ID_PREFIX = {"word": "w:", "sentence": "s:", "blank": "f:", "dialogue": "d:", "grammar": "g:", "culture": "c:"}


@pytest.fixture(scope="module")
def db():
    return build_db.build(OUTLINE, DATA, {"cost_usd": 1.5})


def test_ids_stable_across_runs(db, tmp_path):
    again = build_db.build(json.loads(json.dumps(OUTLINE)), build_db.load_lessons(OUTLINE), {"cost_usd": 1.5})
    assert again == db
    # written twice to disk: byte-identical
    build_db.write(db, tmp_path / "a")
    build_db.write(again, tmp_path / "b")
    for name in ("content.js", "content.json"):
        assert (tmp_path / "a" / name).read_bytes() == (tmp_path / "b" / name).read_bytes()


def test_ids_depend_only_on_lesson_and_position(db):
    # adding a lesson at the end (here: removing the last written one) must not change earlier items
    drop = [m["id"] for u in OUTLINE["units"] for m in u["lessons"] if m["id"] in DATA][-1]
    smaller = build_db.build(OUTLINE, {k: v for k, v in DATA.items() if k != drop})
    gone = {i for i, it in db["items"].items() if it["lesson"] == drop}
    assert gone and set(smaller["items"]) == set(db["items"]) - gone
    for item_id, it in smaller["items"].items():
        if drop not in db["items"][item_id]["lessons"]:
            assert it == db["items"][item_id]
        else:   # a merged word that also appears in the dropped lesson: only its refs shrink
            assert {k: v for k, v in it.items() if k not in ("refs", "lessons", "topics", "alt_en")} == \
                   {k: v for k, v in db["items"][item_id].items() if k not in ("refs", "lessons", "topics", "alt_en")}


def test_counts_match_lessons(db):
    lessons = {l["id"]: l for l in db["lessons"]}
    assert len(db["lessons"]) == sum(len(u["lessons"]) for u in OUTLINE["units"])
    assert sum(l["written"] for l in db["lessons"]) == len(DATA)
    for lid, d in DATA.items():
        l = lessons[lid]
        assert len(l["words"]) == len(d["vocab"])
        assert len(l["sentences"]) == len(d["sentences"])
        assert len(l["fill_blank"]) == len(d.get("fill_blank") or [])
        assert bool(l["grammar"]) == bool(d.get("grammar"))
        assert bool(l["dialogue"]) == bool(d.get("dialogue"))
        for i, wid in enumerate(l["words"]):     # every lesson word points to an item with that Mongolian word
            assert build_db.word_key(db["items"][wid]["mn"]) == build_db.word_key(d["vocab"][i]["mn"])
            assert {"lesson": lid, "i": i} in db["items"][wid]["refs"]
        for i, sid in enumerate(l["sentences"]):
            assert sid == f"s:{lid}:{i}" and db["items"][sid]["en"] == d["sentences"][i]["en"]
    s = db["stats"]
    assert s["lessons"] == len(DATA) and s["words"] == sum(len(d["vocab"]) for d in DATA.values())
    assert s["sentences"] == sum(len(d["sentences"]) for d in DATA.values()) == s["db_counts"]["sentence"]
    assert s["planned_lessons"] == len(db["lessons"]) and s["cost_usd"] == 1.5     # old stats kept
    assert sum(s["db_counts"].values()) == s["db_items"] == len(db["items"])


def test_words_merged_with_all_refs(db):
    words = [it for it in db["items"].values() if it["type"] == "word"]
    keys = [build_db.word_key(w["mn"]) for w in words]
    assert len(keys) == len(set(keys)), "one item per Mongolian word"
    assert len(words) < sum(len(d["vocab"]) for d in DATA.values())
    assert sum(len(w["refs"]) for w in words) == sum(len(d["vocab"]) for d in DATA.values())
    hello = db["items"]["w:u01l1:0"]
    assert hello["mn"] == "сайн байна уу" and len(hello["lessons"]) > 1
    for w in words:
        first = w["refs"][0]
        assert w["id"] == f"w:{first['lesson']}:{first['i']}" and w["lesson"] == first["lesson"]
        assert w["lessons"] == list(dict.fromkeys(r["lesson"] for r in w["refs"]))
        assert w["en"] not in w["alt_en"]


def test_merge_on_tiny_course():
    outline = {"units": [{"id": "u01", "level": "A1", "title_en": "Food", "scope": "food; x", "lessons": [
        {"id": "u01l1", "title_en": "Tea", "focus": "Ordering tea at a cafe; цай"},
        {"id": "u01l2", "title_en": "Milk", "focus": "Buying milk"}, {"id": "u01l3", "title_en": "Later"}]}]}
    data = {"u01l1": {"vocab": [{"mn": "цай", "en": "tea", "pos": "noun"}, {"mn": "сүү", "en": "milk"}], "sentences": []},
            "u01l2": {"vocab": [{"mn": "Сүү", "en": "milk (dairy)"}, {"mn": "цай ", "en": "tea"}],
                      "sentences": [{"mn": "Цай уу.", "en": "Drink tea."}],
                      "fill_blank": [{"mn": "___ уу.", "answer": "Цай", "options": ["Цай", "Сүү"], "translation": "Drink tea."}]}}
    db = build_db.build(outline, data)
    assert [w for w in db["items"] if w.startswith("w:")] == ["w:u01l1:0", "w:u01l1:1"]
    milk = db["items"]["w:u01l1:1"]
    assert milk["alt_en"] == ["milk (dairy)"] and milk["lessons"] == ["u01l1", "u01l2"]
    assert milk["refs"] == [{"lesson": "u01l1", "i": 1}, {"lesson": "u01l2", "i": 0}]
    assert db["lessons"][1]["words"] == ["w:u01l1:1", "w:u01l1:0"]
    assert "buying" in milk["topics"] and "tea" in milk["topics"] and "food" in milk["topics"]
    f = db["items"]["f:u01l2:0"]
    assert (f["lang"], f["text"], f["mn_latin"]) == ("mn", "___ уу.", "___ uu.")   # {mn: ...} form tolerated
    assert db["items"]["s:u01l2:0"]["mn_latin"] == "Tsai uu."
    assert [it["order"] for it in db["items"].values()] == list(range(len(db["items"])))
    assert db["lessons"][2]["written"] is False and db["lessons"][2]["words"] == []
    assert db["units"][0]["lessons"] == ["u01l1", "u01l2", "u01l3"]


def test_every_item_tagged(db):
    orders = sorted(it["order"] for it in db["items"].values())
    assert orders == list(range(len(db["items"])))
    unit_of = {l["id"]: l["unit"] for l in db["lessons"]}
    for item_id, it in db["items"].items():
        assert item_id == it["id"] and item_id.startswith(ID_PREFIX[it["type"]])
        assert it["level"] in ("A1", "A2", "B1", "B2", "C1", "C2") and unit_of[it["lesson"]] == it["unit"]
        assert it["lesson"] in it["lessons"] and it["topics"] and isinstance(it["mn_latin"], str)
    for s in (it for it in db["items"].values() if it["type"] == "sentence"):
        assert isinstance(s["alt_mn"], list) and isinstance(s["alt_en"], list)
    # course order: items of an earlier lesson come first
    pos = {l["id"]: l["order"] for l in db["lessons"]}
    items = sorted(db["items"].values(), key=lambda it: it["order"])
    assert [pos[it["lesson"]] for it in items] == sorted(pos[it["lesson"]] for it in items)


def test_romanize_matches_lesson_latin():
    assert build_db.romanize("Өглөөний мэнд") == "Öglöönii mend"
    v = DATA["u01l1"]["vocab"][0]
    assert build_db.romanize(v["mn"]) == v["mn_latin"]


def test_written_files_and_schema(db, tmp_path):
    build_db.write(db, tmp_path)
    js = (tmp_path / "content.js").read_text(encoding="utf-8")
    assert js.startswith("/* Generated by build_db.py") and "YARYA_DB schema" in js.split("*/")[0]
    body = js[js.index("window.YARYA_DB = ") + len("window.YARYA_DB = "):].rstrip().rstrip(";")
    assert json.loads(body) == json.loads((tmp_path / "content.json").read_text(encoding="utf-8")) == db
    readme = (ROOT / "course" / "db" / "README.md").read_text(encoding="utf-8")
    assert build_db.SCHEMA in readme


def test_committed_db_is_current(db):
    # course/db must be rebuilt (python build_db.py) after the lessons change
    path = ROOT / "course" / "db" / "content.json"
    assert path.exists(), "run build_db.py"
    on_disk = json.loads(path.read_text(encoding="utf-8"))
    assert on_disk["items"] == db["items"] and on_disk["lessons"] == db["lessons"]


def test_story_js(tmp_path):
    # story.json -> story.js: text fields only, odd entries dropped, loadable as window.YARYA_STORY
    src = tmp_path / "story.json"
    src.write_text(json.dumps({
        "u01l1": {"en2mn": {"npc": " Bold ", "intro": "Hi.", "extra": "x", "win": 3, "lose": ""}, "mn2en": "bad"},
        "u01l2": "nonsense", "u01l3": {"en2mn": {"npc": "  "}},
    }), encoding="utf-8")
    assert build_db.write_story(src, tmp_path) == 1
    js = (tmp_path / "story.js").read_text(encoding="utf-8")
    assert js.startswith("/* Generated by build_db.py") and "window.YARYA_STORY = " in js
    body = js[js.index("window.YARYA_STORY = ") + len("window.YARYA_STORY = "):].rstrip().rstrip(";")
    assert json.loads(body) == {"u01l1": {"en2mn": {"npc": "Bold", "intro": "Hi."}}}
    assert build_db.write_story(tmp_path / "missing.json", tmp_path / "none") == 0
    assert not (tmp_path / "none").exists()


def test_committed_story_is_current():
    src = build_db.STORY_FILE
    if not src.exists():
        pytest.skip("no course/db/story.json")
    js = (ROOT / "course" / "db" / "story.js").read_text(encoding="utf-8")
    story = json.loads(js[js.index("= ") + 2:].rstrip().rstrip(";"))
    assert set(story) == {k for k, v in json.loads(src.read_text(encoding="utf-8")).items() if isinstance(v, dict)}, \
        "run build_db.py --story"
