import json, soundfile as sf
L=json.load(open("layout.json")); T=0
for s in L["scenes"]:
    d=sf.info(f"scene_{s['id']}.wav").duration; n=len(s["items"]); step=(d-2.0)/n
    s["dur"]=round(d+0.4,2); s["start"]=round(T,2)
    for i,it in enumerate(s["items"]): it["t"]=round(0.6+i*step,2)
    T+=d+0.4
L["total"]=round(T,2); json.dump(L,open("layout.json","w"),ensure_ascii=False,indent=1)
import numpy as np
a=[]
for s in L["scenes"]:
    x,sr=sf.read(f"scene_{s['id']}.wav"); a+=[x,np.zeros(int(sr*0.4))]
sf.write("master.wav",np.concatenate(a),22050); print("total",L["total"])
