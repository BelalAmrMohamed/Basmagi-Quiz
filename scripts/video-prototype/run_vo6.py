import warnings; warnings.filterwarnings("ignore")
import sys; sys.path.insert(0,'.')
from vo import *
M2=M
EN=["The derivative of x squared equals two x.","In a maximization problem, the optimal solution is reached when all coefficients in the Z row are non negative.","The pivot key is the intersection of the pivot row and the pivot column.","A slack variable converts an inequality into an equation.","The integral from zero to one of x d x equals one over two."]
cands={"kokoro-5":("k",5),"kokoro-6":("k",6),"kokoro-9":("k",9),"kokoro-10":("k",10),
 "ryan-high":("v","vits-piper-en_US-ryan-high","en_US-ryan-high"),"joe":("v","vits-piper-en_US-joe-medium","en_US-joe-medium"),"john":("v","vits-piper-en_US-john-medium","en_US-john-medium"),"norman":("v","vits-piper-en_US-norman-medium","en_US-norman-medium")}
kk=kokoro(); import json
res={}
for name,c in cands.items():
    if c[0]=="k": t=kk; sid=c[1]
    else:
        if not os.path.exists(f"{M}/{c[1]}"): continue
        t=vits(f"{M}/{c[1]}",c[2]); sid=0
    cs=[];st=[];mean=[];dur=0;aud=[]
    for s in EN:
        g=t.generate(s,sid=sid,speed=1.0); x=np.array(g.samples,dtype=np.float32); sr=g.sample_rate; dur+=len(x)/sr
        h=transcribe(x,sr,"en"); cs.append(cer(s,h,"en")[0]); f=f0stats(x,sr); st.append(f["std_st"]); mean.append(f["mean"]); aud.append(resample(x,sr,22050)); aud.append(np.zeros(8000,dtype=np.float32))
    sf.write(f"en_{name}.wav",np.concatenate(aud),22050)
    res[name]=dict(cer=round(sum(cs)/len(cs),3),f0mean=round(sum(mean)/len(mean)),f0std=round(sum(st)/len(st),2),dur=round(dur,1))
    print("RES",name,res[name],flush=True)
