import warnings; warnings.filterwarnings("ignore")
from vo import *
import mishkal.tashkeel as T, json, re
vk=T.TashkeelClass()
narr=json.load(open("narr.json"))
SR=22050; gap=lambda ms:np.zeros(int(SR*ms/1000),dtype=np.float32)
def diac(t):
    parts=re.split(r"(الـ)",t)  # keep tatweel prefix
    t2=t.replace("الـ","ال")
    try: return vk.tashkeel(t2)
    except Exception as e: return t2
rows=[];full=[]
for sc in narr:
    audio=[]
    for r in sc["runs"]:
        txt=re.sub(r"[،]+\s*\.?$","",r["text"]).strip()
        pause=260 if re.search(r"[،.:]\s*\.?$",r["text"]) else 120
        if r["lang"]=="ar":
            t=diac(txt); x,sr=synth("ar-med",t); h=transcribe(x,sr,"ar"); c,_,hh=cer(txt,h,"ar")
        else:
            x,sr=synth("en-amy",txt); h=transcribe(x,sr,"en"); c,_,hh=cer(txt,h,"en")
        x=resample(x,sr,SR); audio+= [x,gap(pause)]
        rows.append((sc["id"],r["lang"],txt[:60],round(c,2),hh[:60]))
    a=np.concatenate(audio); full.append(a); sf.write(f"scene_{sc['id']}.wav",a,SR)
    print(sc["id"],"audio",round(len(a)/SR,1),"s")
for r in rows: print(r)
ar=[r[3] for r in rows if r[1]=="ar"]; en=[r[3] for r in rows if r[1]=="en"]
print("MIXED split-voice: ar CER",round(sum(ar)/len(ar),3),"en CER",round(sum(en)/len(en),3))
# baseline: English terms spoken by Arabic voice
terms=[r[2] for r in rows if r[1]=="en"]
b=[]
for t in terms:
    x,sr=synth("ar-med",t); h=transcribe(x,sr,"en"); c,_,hh=cer(t,h,"en"); b.append(c); print("AR-voice-on-English:",t,"->",hh[:50],round(c,2))
print("baseline en-term CER via Arabic voice",round(sum(b)/len(b),3))
sf.write("mixed_all.wav",np.concatenate(full),SR)
