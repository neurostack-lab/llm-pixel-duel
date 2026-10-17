"""Собирает deepseek/index.html и opus/index.html из оригинальных ответов моделей (raw/).

Что делает: встраивает sound/sfx.js отдельным тегом <script> перед кодом игры
и добавляет вызовы __SFX.play('имя') в точках событий (прыжок, монета, враг и т.д.).
Каждая правка — строгая замена, которая встречается в оригинале ровно один раз.
Геймплей, графика и автопилот не меняются.

Запуск из корня репозитория:  python3 sound/build.py
"""
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
SFX = (ROOT / "sound" / "sfx.js").read_text(encoding="utf-8")

PATCHES = {
 "deepseek": ("deepseek.html", [
  ("  // jump\n  if(jumpEdge && player.onGround){\n    player.vy = JUMPV;\n    player.onGround = false;\n  }",
   "  const __wasGround = player.onGround; // sfx\n  // jump\n  if(jumpEdge && player.onGround){\n    player.vy = JUMPV;\n    player.onGround = false;\n    __SFX.play('jump'); // sfx\n  }"),
  ("  player.y += player.vy;\n  player.onGround = false;\n",
   "  player.y += player.vy;\n  player.onGround = false;\n  const __vyPre = player.vy; // sfx\n"),
  ("  // animation state\n",
   "  if(player.onGround && !__wasGround && __vyPre > 1.5) __SFX.play('land'); // sfx\n\n  // animation state\n"),
  ("      score += 10;\n", "      score += 10;\n      __SFX.play('coin'); // sfx\n"),
  ("        score += 20;\n", "        score += 20;\n        __SFX.play('stomp'); // sfx\n"),
  ("  if(lives <= 0){ hardReset(); return; }\n",
   "  if(lives <= 0){ __SFX.play('death'); hardReset(); return; } // sfx\n  __SFX.play('hurt'); // sfx\n"),
 ]),
 "opus": ("opus.html", [
  ("p.jumpBuf=0;dust(p.x+p.w/2,p.y+p.h,4);}", "p.jumpBuf=0;dust(p.x+p.w/2,p.y+p.h,4);__SFX.play('jump');}"),
  ("if(!wasGround&&prevVy>2.2)dust(p.x+p.w/2,p.y+p.h,5);}}",
   "if(!wasGround&&prevVy>2.2)dust(p.x+p.w/2,p.y+p.h,5);if(!wasGround&&prevVy>1.5)__SFX.play('land');}}"),
  ("burst(p.x+p.w/2,p.y,4,['#fc9838','#c84c0c'],0.8,0.1,18);}}", "burst(p.x+p.w/2,p.y,4,['#fc9838','#c84c0c'],0.8,0.1,18);__SFX.play('bump');}}"),
  ("score+=100;floater(e.x,e.y-6,'+100');", "score+=100;__SFX.play('stomp');floater(e.x,e.y-6,'+100');"),
  ("coins.splice(i,1);score+=10;coinCount++;", "coins.splice(i,1);score+=10;coinCount++;__SFX.play('coin');"),
  ("if(coinCount%50===0){lives++;", "if(coinCount%50===0){lives++;__SFX.play('oneup');"),
  ("function loseLife(){lives--;if(lives<=0){state='over';timer=210;return true;}return false;}",
   "function loseLife(){lives--;if(lives<=0){state='over';timer=210;__SFX.play('death');return true;}__SFX.play('hurt');return false;}"),
  ("state='clear';timer=160;score+=500;", "state='clear';timer=160;score+=500;__SFX.play('clear');"),
 ]),
}
for name, (src, patches) in PATCHES.items():
    h = (ROOT / "raw" / src).read_text(encoding="utf-8")
    for old, new in patches:
        assert h.count(old) == 1, (name, old)
        h = h.replace(old, new)
    anchor = "<script>\n"
    assert h.count(anchor) == 1
    h = h.replace(anchor, "<script>\n" + SFX + "</script>\n<script>\n", 1)
    out = ROOT / name / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(h, encoding="utf-8")
    print(name, len(h.encode()), "bytes,", len(patches), "patches")
