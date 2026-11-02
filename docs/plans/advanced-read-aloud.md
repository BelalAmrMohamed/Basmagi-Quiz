My Suggestion (You can recomment better if possible): 

## Models
- *Main Models*: Use Microsoft Azure Neural TTS or Cartesia (Sonic) for generating the VO.
- *Alternative*: I'm also thinking of Self-Hosted Open-Source AI Models, if they would be a better option.
- *Fallback to Web Speech API*: Use window.speechSynthesis as a client-side fallback for free unlimited usage if a user exceeds trial limits or loses network connection.

## Features
* *Word Boundary Syncing*: Enable synchronized word-by-word or sentence-level highlighting (Fall back for section highlighting with the Web Speech API).
* *Math & Code Filtering*: Pre-process markdown/LaTeX into natural language before sending to the TTS API (e.g., convert $\frac{1}{2}$ to "one-half"). Because raw AI voices often struggle to read raw code snippets, LaTeX formulas, or table structures naturally without text cleaning.
* *Playback Speed Controls*: They already exist.
* *Read Section Button Redesign*: The current 3 buttons that pop up when a user selects text, the read-aloud button should have different/special styling that the other 2 + an icon.
* *Text Filtering*: Spacial Characters like Emojis shouldn't be read.

## Important to decidisoins before implementing
* *Mixed Arabic & English*: Since the platform has heavy mixing of English & Arabic, specially in lessons where this feature will be mainly implemented. Specially: we have to decide which model works best for MATH (Arabic or English) and this is extremely important.
* *Audio Caching*: This is important to have all of the context about it. I'm using Supabase (Free Tier), so audio caching might fill up the Database heavily. So we have 2 options: 
    1. *No Audio Caching*: We don't cache audio at all.
    2. *New Second Free-Tier DB*: We connect a new second Database from a new Supabase account of Firebase for storing the audio cache + admin uploaded contents from the *create* pages.

If this feature succeeds, I will use it for an MCP Feature I'm working on (Lesson to video export using Claude), that new feature has a big issue, which is the VO is really bad. So succeeding in this is important.

Interiogate me to get oll of the context you need.