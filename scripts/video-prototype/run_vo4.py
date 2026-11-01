import warnings; warnings.filterwarnings("ignore")
from vo import *
import mishkal.tashkeel as T, json, re
vk=T.TashkeelClass(); narr=json.load(open("narr.json"))
ONES=["صفر","واحد","اثنان","ثلاثة","أربعة","خمسة","ستة","سبعة","ثمانية","تسعة","عشرة","أحد عشر","اثنا عشر"]
def digits2words(s): return re.sub(r"\d+",lambda m: ONES[int(m.group())] if int(m.group())<len(ONES) else m.group(),s)
ar=[];en=[]
for sc in narr:
    for r in sc["runs"]:
        txt=re.sub(r"[،.:]+\s*\.?$","",r["text"]).strip(); w=len(txt.split())
        if r["lang"]=="ar" and w>=4:
            x,sr=synth("ar-med",vk.tashkeel(txt.replace("الـ","ال"))); h=digits2words(transcribe(x,sr,"ar")); ar.append(cer(txt,h,"ar")[0])
        if r["lang"]=="en" and w>=2:
            x,sr=synth("en-amy",txt); h=transcribe(x,sr,"en"); en.append(cer(txt,h,"en")[0])
print("RES ar runs>=4 words:",len(ar),"avg CER",round(sum(ar)/len(ar),3),[round(c,2) for c in ar])
print("RES en runs>=2 words:",len(en),"avg CER",round(sum(en)/len(en),3),[round(c,2) for c in en])
