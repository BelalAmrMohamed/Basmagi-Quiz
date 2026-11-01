from vo import *
import json
EN=["The derivative of x squared equals two x.","In a maximization problem, the optimal solution is reached when all coefficients in the Z row are non negative.","The pivot key is the intersection of the pivot row and the pivot column.","A slack variable converts an inequality into an equation.","The discriminant equals b squared minus four a c.","Image thresholding converts a grayscale image into a binary image."]
AR=["في مسألة التعظيم نكتب دالة الهدف مع القيد","نبحث في صف دالة الهدف عن أقل قيمة سالبة","العمود الذي يحتوي عليها هو عمود الارتكاز","نقسم الحد المطلق على القيم المقابلة لها في عمود الارتكاز","أقل نسبة موجبة تحدد صف الارتكاز","إذا كان المعامل يساوي صفرا فإن الصف ينزل كما هو"]
res={}
for eng,sents,lang in [("en-lessac",EN,"en"),("en-amy",EN,"en"),("en-kokoro",EN,"en"),("ar-med",AR,"ar"),("ar-low",AR,"ar")]:
    tot=[];t0=time.time();dur=0
    for i,s in enumerate(sents):
        x,sr=synth(eng,s,sid=(3 if eng=="en-kokoro" else 0)); dur+=len(x)/sr
        h=transcribe(x,sr,lang); c,r,hh=cer(s,h,lang); tot.append(c)
        if i==0: sf.write(f"s_{eng}.wav",x,sr)
        print(eng,f"{c:.2f}","|",hh[:70])
    res[eng]=dict(cer=sum(tot)/len(tot),audio_s=round(dur,1),wall_s=round(time.time()-t0,1))
    print("==",eng,res[eng],flush=True)
json.dump(res,open("vo1.json","w"),indent=1)
