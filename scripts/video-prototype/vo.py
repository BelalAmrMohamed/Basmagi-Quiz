import sherpa_onnx as so, numpy as np, soundfile as sf, re, json, sys, time, os
S="/tmp/claude-0/-home-claude/efddf821-71f4-53df-90c1-ae387ed8ec1c/scratchpad"
M=S+"/models"
def vits(d,n,ns=0.667,nw=0.8,ls=1.0):
    c=so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(vits=so.OfflineTtsVitsModelConfig(model=f"{d}/{n}.onnx",tokens=f"{d}/tokens.txt",data_dir=f"{d}/espeak-ng-data",noise_scale=ns,noise_scale_w=nw,length_scale=ls),num_threads=2))
    return so.OfflineTts(c)
def kokoro():
    d=M+"/kokoro-en-v0_19"
    c=so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(kokoro=so.OfflineTtsKokoroModelConfig(model=d+"/model.onnx",voices=d+"/voices.bin",tokens=d+"/tokens.txt",data_dir=d+"/espeak-ng-data"),num_threads=2))
    return so.OfflineTts(c)
ENG={
 "ar-med":lambda:vits(S+"/vits-piper-ar_JO-kareem-medium","ar_JO-kareem-medium"),
 "ar-low":lambda:vits(M+"/vits-piper-ar_JO-kareem-low","ar_JO-kareem-low"),
 "en-lessac":lambda:vits(S+"/vits-piper-en_US-lessac-medium","en_US-lessac-medium"),
 "en-amy":lambda:vits(M+"/vits-piper-en_US-amy-medium","en_US-amy-medium"),
 "en-kokoro":kokoro,
}
_c={}
def tts(name):
    if name not in _c: _c[name]=ENG[name]()
    return _c[name]
def synth(name,text,sid=0,speed=1.0):
    g=tts(name).generate(text,sid=sid,speed=speed)
    x=np.array(g.samples,dtype=np.float32); return x,g.sample_rate
def resample(x,sr,to=22050):
    if sr==to: return x
    n=int(len(x)*to/sr); return np.interp(np.linspace(0,len(x)-1,n),np.arange(len(x)),x).astype(np.float32)
# ASR
_r={}
def asr(lang):
    if lang not in _r:
        d=M+"/sherpa-onnx-whisper-small"
        _r[lang]=so.OfflineRecognizer.from_whisper(encoder=d+"/small-encoder.int8.onnx",decoder=d+"/small-decoder.int8.onnx",tokens=d+"/small-tokens.txt",language=lang,task="transcribe",num_threads=2)
    return _r[lang]
def transcribe(x,sr,lang):
    r=asr(lang); st=r.create_stream(); st.accept_waveform(sr,x); r.decode_stream(st); return st.result.text.strip()
# metrics
TASH=re.compile("[ؐ-ًؚ-ٰٟـ]")
def norm(s,lang):
    s=s.lower(); s=TASH.sub("",s)
    s=re.sub("[إأآٱ]","ا",s); s=s.replace("ى","ي").replace("ة","ه").replace("ؤ","و").replace("ئ","ي")
    s=re.sub(r"[^\w\s]|_"," ",s); return re.sub(r"\s+"," ",s).strip()
def lev(a,b):
    p=list(range(len(b)+1))
    for i,ca in enumerate(a,1):
        c=[i]
        for j,cb in enumerate(b,1): c.append(min(p[j]+1,c[j-1]+1,p[j-1]+(ca!=cb)))
        p=c
    return p[-1]
def cer(ref,hyp,lang):
    r,h=norm(ref,lang),norm(hyp,lang); return lev(r,h)/max(1,len(r)), r, h

import parselmouth, subprocess, tempfile
def f0stats(x,sr):
    snd=parselmouth.Sound(x.astype(np.float64),sampling_frequency=sr)
    p=snd.to_pitch(time_step=0.01,pitch_floor=70,pitch_ceiling=400); f=p.selected_array["frequency"]; v=f[f>0]
    if len(v)<10: return dict(mean=0,std_st=0,voiced=0)
    st=12*np.log2(v/np.median(v)); return dict(mean=round(float(v.mean())),std_st=round(float(st.std()),2),voiced=round(len(v)/len(f),2))
def fx(x,sr,chain):
    """apply ffmpeg audio filter chain to float32 samples, return float32 samples at same sr"""
    with tempfile.TemporaryDirectory() as d:
        sf.write(d+"/i.wav",x,sr); subprocess.run(["ffmpeg","-loglevel","error","-y","-i",d+"/i.wav","-af",chain,d+"/o.wav"],check=True)
        y,sr2=sf.read(d+"/o.wav",dtype="float32"); return y,sr2
