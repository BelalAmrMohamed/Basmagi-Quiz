/**
 * Vercel Serverless Function - Gemini API Proxy
 * Endpoint: /api/chat
 * Method: POST
 *
 * This function securely proxies requests to Google's Gemini API
 * without exposing the API key to the client.
 * test conectivity with this in the browser console:

fetch('/api/chat', {  method: 'POST',  headers: { 'Content-Type': 'application/json' },  body: JSON.stringify({ prompt: 'Hello!' }) }).then(r => r.json()).then(console.log);
*/

export default async function handler(req, res) {
  const ALLOWED_ORIGINS = [
    "https://basmagi-quiz.vercel.app",
    "http://localhost:3000",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8080",
  ];

  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
      message: "This endpoint only accepts POST requests",
    });
  }

  try {
    // Get API key from environment variables
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not set in environment variables");
      return res.status(500).json({
        error: "Server configuration error",
        message: "API key is not configured",
      });
    }

    // Extract request data
    const { prompt, systemInstruction, model = "gemini-2.0-flash" } = req.body;

    // Validate prompt
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({
        error: "Invalid request",
        message: "Prompt is required and must be a string",
      });
    }

    // Build the request body for Gemini API
    const geminiRequestBody = {
      contents: [
        {
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
    };

    // Add system instruction if provided
    if (systemInstruction) {
      geminiRequestBody.systemInstruction = {
        parts: [
          {
            text: systemInstruction,
          },
        ],
      };
    }

    // Call Gemini API
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(geminiRequestBody),
      },
    );

    // Check if the request was successful
    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json();
      console.error("Gemini API error:", errorData);
      return res.status(geminiResponse.status).json({
        error: "Gemini API error",
        message:
          errorData.error?.message || "Failed to get response from Gemini",
        details: errorData,
      });
    }

    // Parse and return the response
    const data = await geminiResponse.json();

    return res.status(200).json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}
