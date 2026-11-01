import warnings; warnings.filterwarnings("ignore")
import sys; sys.path.insert(0,'.')
from vo import *
import mishkal.tashkeel as T, re
vk=T.TashkeelClass(); SR=22050
AR_FX="highpass=f=70,equalizer=f=250:t=q:w=1:g=2,equalizer=f=3200:t=q:w=1.2:g=3,acompressor=threshold=-22dB:ratio=3:attack=5:release=90,loudnorm=I=-17:TP=-1.5"
EN_FX="highpass=f=60,acompressor=threshold=-22dB:ratio=2.5:attack=5:release=90,loudnorm=I=-17:TP=-1.5"
_kk=None;_ar=None
def engines():
    global _kk,_ar
    if _kk is None: _kk=kokoro(); _ar=vits(S+"/vits-piper-ar_JO-kareem-medium","ar_JO-kareem-medium")
    return _kk,_ar
def gap(ms): return np.zeros(int(SR*ms/1000),dtype=np.float32)
def speak_run(run,cfg):
    kk,ar=engines(); txt=re.sub(r"[،.:]+\s*\.?$","",run["text"]).strip()
    if run["lang"]=="ar":
        g=ar.generate(vk.tashkeel(txt.replace("الـ","ال")),sid=0,speed=cfg.get("ar_speed",1.0)); x=np.array(g.samples,dtype=np.float32); sr=g.sample_rate
        if cfg.get("fx",True): x,sr=fx(x,sr,AR_FX+(f",atempo={cfg['tempo']}" if cfg.get("tempo") else ""))
    else:
        g=kk.generate(txt,sid=cfg.get("en_sid",6),speed=cfg.get("en_speed",1.0)); x=np.array(g.samples,dtype=np.float32); sr=g.sample_rate
        if cfg.get("fx",True): x,sr=fx(x,sr,EN_FX)
    return resample(x,sr,SR)
def speak(runs,cfg):
    out=[];dur=[]
    for r in runs:
        x=speak_run(r,cfg); pause=260 if re.search(r"[،.,:]\s*\.?$",r["text"]) else 120
        out+=[x,gap(pause)]; dur.append(len(x)/SR+pause/1000)
    return np.concatenate(out),dur
