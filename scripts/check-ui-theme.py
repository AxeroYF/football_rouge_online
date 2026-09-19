"""Offline CSS cascade checks, not a browser/layout screenshot test.

Uses locally installed tinycss2 / beautifulsoup4 / soupsieve. Loads the real
stylesheets in HTML order and checks representative production components.
Run from the worktree: python scripts/check-ui-theme.py
"""
from pathlib import Path
import json
import re
import tinycss2 as css
from bs4 import BeautifulSoup
import soupsieve

ROOT = Path(__file__).resolve().parent.parent
PREVIEW = ROOT / "outputs/ui-theme-review/style-guide.html"


def split_selectors(tokens):
    groups, part = [], []
    for token in tokens:
        if token.type == "literal" and token.value == ",":
            groups.append(part)
            part = []
        else:
            part.append(token)
    return groups + [part]


def specificity(tokens):
    tokens = [t for t in tokens if t.type not in ("comment", "whitespace")]
    result = [0, 0, 0]
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token.type == "hash":
            result[0] += 1
        elif token.type == "[] block":
            result[1] += 1
        elif token.type == "literal" and token.value == ".":
            result[1] += 1
            i += 1
        elif token.type == "literal" and token.value == ":":
            i += 1
            token = tokens[i]
            if token.type == "literal" and token.value == ":":
                result[2] += 1
                i += 1
            elif token.type == "function" and token.name in ("is", "not", "has", "where"):
                if token.name != "where":
                    value = max(specificity(group) for group in split_selectors(token.arguments))
                    result = [a + b for a, b in zip(result, value)]
            else:
                result[1] += 1
        elif token.type == "ident":
            result[2] += 1
        i += 1
    return tuple(result)


def media_applies(query, width):
    if "prefers-reduced-motion: reduce" in query:
        return False
    for kind, limit in re.findall(r"(max|min)-width\s*:\s*(\d+)px", query):
        if (kind == "max" and width > int(limit)) or (kind == "min" and width < int(limit)):
            return False
    return True


def rules_from(text, width):
    def visit(rules):
        for rule in rules:
            if rule.type == "at-rule" and rule.lower_at_keyword == "media" and media_applies(css.serialize(rule.prelude), width):
                yield from visit(css.parse_rule_list(rule.content, skip_comments=True, skip_whitespace=True))
            elif rule.type == "qualified-rule":
                yield rule
    return visit(css.parse_stylesheet(text, skip_comments=True, skip_whitespace=True))


class Cascade:
    def __init__(self, soup, files, width, include_theme=True):
        self.soup, self.rules, self.cache = soup, [], {}
        for file in files:
            if not include_theme and file.name == "ui-theme.css":
                continue
            for rule in rules_from(file.read_text(encoding="utf-8"), width):
                declarations = [d for d in css.parse_declaration_list(rule.content) if d.type == "declaration"]
                for group in split_selectors(rule.prelude):
                    selector = css.serialize(group).strip()
                    if "::" in selector or re.search(r":(?:before|after|first-line|first-letter)(?![-\w])", selector):
                        continue  # Pseudo elements are not the inspected DOM nodes.
                    selector = re.sub(r":(hover|focus-visible|focus-within|focus)(?![-\w])", r"[data-preview-\1]", selector)
                    try:
                        compiled = soupsieve.compile(selector)
                    except NotImplementedError:
                        continue
                    self.rules.append((compiled, specificity(group), declarations))

    def raw(self, element):
        key = id(element)
        if key in self.cache:
            return self.cache[key]
        values = {}
        for order, (selector, spec, declarations) in enumerate(self.rules):
            if not selector.match(element):
                continue
            for offset, declaration in enumerate(declarations):
                rank = (declaration.important, (0, *spec), order, offset)
                old = values.get(declaration.name)
                if not old or rank >= old[0]:
                    values[declaration.name] = (rank, css.serialize(declaration.value).strip())
        for offset, declaration in enumerate(css.parse_declaration_list(element.get("style", ""))):
            if declaration.type == "declaration":
                rank = (declaration.important, (1, 0, 0, 0), len(self.rules), offset)
                old = values.get(declaration.name)
                if not old or rank >= old[0]:
                    values[declaration.name] = (rank, css.serialize(declaration.value).strip())
        self.cache[key] = values
        return values

    def variable(self, element, name):
        while element and element.name != "[document]":
            value = self.raw(element).get(name)
            if value:
                return value[1]
            element = element.parent
        return None

    def resolve(self, element, text):
        for _ in range(20):
            updated = re.sub(r"var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)",
                             lambda m: self.variable(element, m[1]) or m[2] or "UNRESOLVED", text)
            if text == updated:
                return updated
            text = updated
        raise AssertionError("Recursive CSS variable: " + text)

    def get(self, element, prop):
        # The assertions inspect these longhands and background shorthands;
        # this intentionally does not attempt to implement browser layout.
        candidates = [self.raw(element).get(prop)]
        if prop == "background":
            candidates.append(self.raw(element).get("background-color"))
        if prop == "color" and not any(candidates) and element.parent.name != "[document]":
            return self.get(element.parent, prop)
        winner = max(filter(None, candidates), default=None)
        return self.resolve(element, winner[1]) if winner else None


def validate_theme_syntax():
    text = (ROOT / "styles/ui-theme.css").read_text(encoding="utf-8")
    def visit(rules):
        for rule in rules:
            assert rule.type != "error", rule
            if rule.type == "at-rule" and rule.content:
                visit(css.parse_rule_list(rule.content, skip_comments=True, skip_whitespace=True))
            elif rule.type == "qualified-rule":
                for group in split_selectors(rule.prelude):
                    selector = css.serialize(group).strip()
                    assert selector.startswith('html[data-ui-theme="club"]'), selector
                    if "::" not in selector:
                        soupsieve.compile(selector)
                for declaration in css.parse_declaration_list(rule.content, skip_comments=True, skip_whitespace=True):
                    assert declaration.type == "declaration", declaration
                    assert not any(v.type == "error" for v in declaration.value), declaration
    visit(css.parse_stylesheet(text, skip_comments=True, skip_whitespace=True))


def main():
    validate_theme_syntax()
    markup = PREVIEW.read_text(encoding="utf-8")
    soup = BeautifulSoup(markup, "html.parser")
    files = [(PREVIEW.parent / link["href"].split("?")[0]).resolve() for link in soup.select('link[rel="stylesheet"]')]
    checks = {}
    for width in (1366, 1920, 2560, 560):
        cascade = Cascade(soup, files, width)
        def check(key, prop, expected):
            element = soup.select_one(f'[data-check="{key}"]')
            assert element, key
            actual = cascade.get(element, prop)
            assert actual == expected, f"{width}px {key} {prop}: {actual} != {expected}"
            checks[f"{width}:{key}:{prop}"] = actual
        for key in ("entry-primary", "scout-primary", "inventory-primary", "training-primary", "building-primary"):
            check(key, "background", "#d4b365")
            check(key, "color", "#141b16")
        for key in ("entry-panel", "team-shell", "scout-shell", "inventory-shell", "enhancement-shell", "yoogle-shell", "player-dialog", "scout-notice", "training-notice", "live-notice"):
            check(key, "background", "#1a241f")
        for key in ("training-close", "scout-close", "inventory-close", "enhancement-close", "team-close", "player-close", "yoogle-close"):
            check(key, "width", "36px")
            check(key, "height", "36px")
        for key in ("entry-input", "team-input", "enhancement-input", "tactics-input"):
            check(key, "background", "#141e18")
        check("enhancement-primary", "background", "radial-gradient(circle at 35% 28%,#fff19a,#f0c83f 55%,#a87919)")
        check("enhancement-primary", "border-radius", "50%")
        check("enhancement-primary", "width", "90px")
        check("enhancement-primary", "height", "90px")
        check("own-panel", "background", "#33291f")
        check("training-secondary", "background", "#24312a")
        check("entry-disabled", "background", "#24312a")
        check("demo-hover", "background", "#e1c581")
        check("scout-progress", "background", "#d4b365")
    # Reverting only the attribute must be equivalent to never loading the new
    # stylesheet, across every preview component and original declared property.
    soup.html["data-ui-theme"] = "legacy"
    legacy, original = Cascade(soup, files, 1920), Cascade(soup, files, 1920, include_theme=False)
    for element in soup.select("[data-check]"):
        before = {k: v[1] for k, v in original.raw(element).items()}
        after = {k: v[1] for k, v in legacy.raw(element).items()}
        assert before == after, "Legacy theme changed: " + element["data-check"]
    admin = BeautifulSoup((ROOT / "admin-v2.html").read_text(encoding="utf-8"), "html.parser")
    admin_files = [(ROOT / link["href"].split("?")[0]).resolve() for link in admin.select('link[rel="stylesheet"]')]
    admin_css = Cascade(admin, admin_files, 1920)
    assert admin_css.get(admin.select_one("#login-submit"), "background") == "#d4b365"
    assert admin_css.get(admin.select_one("#login-submit"), "color") == "#141b16"
    assert admin_css.get(admin.select_one(".login-card"), "background") == "#1a241f"
    assert admin_css.get(admin.select_one('input[name="username"]'), "background") == "#141e18"
    admin.html["data-ui-theme"] = "legacy"
    restored = Cascade(admin, admin_files, 1920)
    baseline = Cascade(admin, admin_files, 1920, include_theme=False)
    for element in admin.select("input, button, .login-card"):
        assert {k: v[1] for k, v in restored.raw(element).items()} == {k: v[1] for k, v in baseline.raw(element).items()}
    report = {"adminChecks": 4, "checks": len(checks), "widths": [1366, 1920, 2560, 560], "legacyComponents": len(soup.select("[data-check]")),
              "scope": "CSS syntax, selector matching and cascade; not browser layout or screenshots", "results": checks}
    (ROOT / "outputs/ui-theme-review/cascade-checks.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Passed {len(checks)} cascade checks; {report['legacyComponents']} legacy components unchanged.")


if __name__ == "__main__":
    main()
