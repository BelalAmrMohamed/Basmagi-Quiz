## Recommendations

**1. Unify the shell and structure (biggest win).** Each doc page copies the same `<head>`, header and scripts, and `about.html` uses a different layout entirely. Tasks, in order of payoff:
- Build the doc pages from one template: a small script that reads each page's content file, so a nav or footer change happens once.
- Group the sidebar into **Start / Create / Connect AI** instead of one flat list. A better order for the pages:
  1. How to create an exam
  2. How to upload an exam
  3. Connect Claude/ChatGPT
  4. The built-in AI assistant
- Add a "last updated" date.

**Only 3 Shells**:
1. The about Page (in its own shell).
2. The "How to" Pages (all in one shell).
3. The "Privacy" and "Terms" Pages (all in one shell)

**Fix the language.** The pages mix formal Arabic with Egyptian dialect: the skill card says "دلوقتي Claude بقى عنده…". Pick one 
register for the docs. Use simple Modern Standard Arabic and keep dialect for the app UI.

**Product ideas that make the docs shorter:**
- A **"Connect" card inside the app**, in My Content or Settings, showing the URL with a copy button. Most people would never open the docs.
- **Show the URL in the sign-in flow too.** Right now it's buried in docs.
- **Link the docs from the toast.** The new "added to My Content" notification could say "First time? See how to connect" for users arriving from a draft link.
- **Run the MCP page through your own import flow.** A "Try it" demo link that opens `/my-content?draft=<demo>` and adds a sample quiz would let people see the end result before connecting anything.

**Screenshots for you to take** (same dark style, 1500×844 if you can):
1. My Content after a draft link opens, with the green «جديد» badge. This is the most important missing image.
2. The success toast: "تمت إضافة الامتحان إلى «محتواي»".
3. Claude's reply containing the link, to show what the user clicks.
4. The Skill upload screen in Claude (Settings → Customize → Skills).
5. A Gemini setup (3 shots), since it currently relies on the video alone.
6. The expired-link error toast, for the FAQ.
7. For `how-to-create-content` and `how-to-upload-content`: the quiz creator with the import button highlighted, and the admin upload screen. Those pages have no screenshots at all.
8. Short GIFs or MP4s (5–8 seconds each) of "open link → item appears and glows". They're lighter than the 9-minute video for this single moment.

**Small technical items:**
- Convert the screenshots to WebP at about 1200px. They're 40–110 KB now, which is fine, but a JPEG/PNG mix will keep growing.
- Add `HowTo` structured data (JSON-LD) to the MCP page for search results.
- The existing video is flagged "recorded before the update". When you can, re-record the 2:21–2:54 segment, or add a 60–90 second clip of the new flow and put it first.