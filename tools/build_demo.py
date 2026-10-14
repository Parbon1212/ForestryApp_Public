"""GitHub Pages 用デモ (docs/) を本番の画面から生成する。

本番の templates/SoccerCalculation.html と static/script.js をそのまま docs/ にコピーし、
<head> に擬似サーバー (docs/demo/mock-server.js) の読み込みを差し込む。
画面を変更したら、このスクリプトを実行して docs/ を更新すること:

    python3 tools/build_demo.py
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"

INJECT = """  <!-- デモ版: ラズパイの API をブラウザ内で再現する（tools/build_demo.py が挿入） -->
  <script src="demo/geographiclib-geodesic.min.js"></script>
  <script src="demo/mock-server.js"></script>
</head>"""


def main():
    html = (ROOT / "templates" / "SoccerCalculation.html").read_text(encoding="utf-8")
    if html.count("</head>") != 1:
        raise SystemExit("</head> が1つではないため挿入位置を決められません")
    html = html.replace("</head>", INJECT)
    html = html.replace("<title>Geo Field Studio</title>", "<title>Geo Field Studio（デモ）</title>")

    (DOCS / "index.html").write_text(html, encoding="utf-8")
    shutil.copy2(ROOT / "static" / "script.js", DOCS / "script.js")
    (DOCS / ".nojekyll").touch()
    print(f"generated: {DOCS / 'index.html'}, {DOCS / 'script.js'}")


if __name__ == "__main__":
    main()
