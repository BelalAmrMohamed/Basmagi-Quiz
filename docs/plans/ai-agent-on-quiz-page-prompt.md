# AI Agent "الباشـمبصمج" — Update Implementation Plan

## Quiz-page AI scoring override

**Goal:** 
1. The assistant can review a question and its formal answer + the user's answer and override the platform's default correctness/score only for essay questions, specially essays from Math or Arabic answers where `gradeEssay`'s keyword-overlap heuristic is unreliable.
2. The assistant can review a question with it's options & its correct answer(s) or formal answer for essay questions and provide a hint for the user that doesn't give out the answer completely. 

This will not be a normal integration of the AI Agent in the quiz page, because we don't want users to get help from AI. This plan isn't finished yet. We will not mount the `createAIAgentFab` and users won't be able to chat with the assistant from the quiz page directly.