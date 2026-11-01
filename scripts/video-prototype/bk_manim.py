import json, os, re
from manim import *
P=os.path.dirname(os.path.abspath(__file__))
L=json.load(open(P+"/layout.json"))
config.pixel_width=1280; config.pixel_height=720; config.frame_rate=30; config.background_color="#0f1320"
SID=os.environ["SID"]
S=[s for s in L["scenes"] if s["id"]==SID][0]
AR=re.compile(r"[؀-ۿ]")
LRM="‎"   # forces LTR base direction: RTL-base Text silently renders EMPTY in Manim/Pango
def bidi_line(s, size, color=WHITE, weight=NORMAL):
    """split into script runs, shape each run alone, place runs right-to-left (manual bidi)."""
    toks=s.split(" "); runs=[]; 
    for t in toks:
        k="ar" if AR.search(t) else "en"
        if runs and runs[-1][0]==k: runs[-1][1].append(t)
        else: runs.append([k,[t]])
    parts=[]
    for k,ws in runs:
        txt=" ".join(ws)
        parts.append(Text((LRM+txt) if k=="ar" else txt, font="Cairo", font_size=size, color=color, weight=weight))
    g=VGroup(*parts).arrange(LEFT,buff=0.16)   # first run ends up rightmost
    return g
class Sc(Scene):
    def construct(self):
      with register_font(P+"/Cairo-400.ttf"), register_font(P+"/Cairo-700.ttf"):
        title=bidi_line(S["title"],44,"#7cc4ff",BOLD)
        group=[title]
        for it in S["items"]:
            if it["k"]=="m":
                m=SVGMobject(P+"/"+it["svg"]); m.set_height(0.8); m.set_color(WHITE)
                if m.width>9: m.scale_to_fit_width(9)
            elif it["k"]=="l":
                m=Text(it["v"],font="Cairo",font_size=26,color="#ffd479")
            else:
                m=bidi_line(it["v"],30)
            if m.width>11.8: m.scale_to_fit_width(11.8)
            group.append(m)
        g=VGroup(*group).arrange(DOWN,buff=0.3,aligned_edge=RIGHT).to_edge(UP,buff=0.45).to_edge(RIGHT,buff=0.7)
        for it,m in zip(S["items"],group[1:]):
            if it["k"]=="m": m.set_x(0)
            if it["k"]=="l": m.align_to(g,LEFT)
        t=0.0
        self.add(title)
        for it,m in sorted(zip(S["items"],group[1:]),key=lambda z:z[0]["t"]):
            if it["t"]>t: self.wait(it["t"]-t); t=it["t"]
            self.play(FadeIn(m,shift=UP*0.15),run_time=0.5); t+=0.5
        if S["dur"]>t: self.wait(S["dur"]-t)
