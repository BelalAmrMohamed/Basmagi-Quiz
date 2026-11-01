import warnings; warnings.filterwarnings("ignore")
from vo import *
import mishkal.tashkeel as T
vk=T.TashkeelClass()
AR=["في مسألة التعظيم نكتب دالة الهدف مع القيد","نبحث في صف دالة الهدف عن أقل قيمة سالبة","العمود الذي يحتوي عليها هو عمود الارتكاز","نقسم الحد المطلق على القيم المقابلة لها في عمود الارتكاز","أقل نسبة موجبة تحدد صف الارتكاز","إذا كان المعامل يساوي صفرا فإن الصف ينزل كما هو"]
for eng in ["ar-med"]:
  for mode in ["raw","tashkeel"]:
    cs=[]
    for s in AR:
        t=s if mode=="raw" else vk.tashkeel(s)
        x,sr=synth(eng,t); h=transcribe(x,sr,"ar"); c,_,hh=cer(s,h,"ar"); cs.append(c)
        if mode=="tashkeel" and s==AR[0]: sf.write("s_ar_tashkeel.wav",x,sr); print(t)
    print(eng,mode,round(sum(cs)/len(cs),3),[round(c,2) for c in cs],flush=True)
# speed effect
for sp in [0.85,1.0]:
    cs=[]
    for s in AR:
        x,sr=synth("ar-med",s,speed=sp); h=transcribe(x,sr,"ar"); cs.append(cer(s,h,"ar")[0])
    print("speed",sp,round(sum(cs)/len(cs),3))
