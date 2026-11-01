set -e
export PATH=/tmp/claude-0/-home-claude/efddf821-71f4-53df-90c1-ae387ed8ec1c/scratchpad/mamba/envs/m/bin:/usr/bin:$PATH
cd $(dirname $0)
rm -rf media_m; : > list.txt
for s in s1 s2 s3 s4 s5; do SID=$s manim -qm --disable_caching --media_dir media_m bk_manim.py Sc -o $s.mp4 >/dev/null 2>&1; echo "file 'media_m/videos/bk_manim/720p30/$s.mp4'" >> list.txt; done
ffmpeg -loglevel error -y -f concat -safe 0 -i list.txt -i master.wav -c:v copy -c:a aac -shortest out_manim.mp4
