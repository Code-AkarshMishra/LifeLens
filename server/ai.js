const { analyzeNotice, splitSentences, parseDeadline } = require("./parser");

function validateAnalysis(parsed, role, sourceText) {
  if (!Array.isArray(parsed.actions) || typeof parsed.summary !== "string") {
    throw new Error("Gemini response did not match the expected analysis format.");
  }
  const sourceSentences = new Set(splitSentences(sourceText));
  const localActions = new Map(analyzeNotice(sourceText, role).actions.map((action) => [action.evidence, action]));
  for (const action of parsed.actions) {
    if (!action.evidence || !sourceSentences.has(action.evidence)
      || (action.consequenceEvidence && !sourceSentences.has(action.consequenceEvidence))) {
      throw new Error("Gemini returned evidence that was not an exact sentence from the notice.");
    }
  }
  return {
    summary: parsed.summary,
    role,
    actions: parsed.actions.map((action) => {
      const evidence = action.evidence;
      const local = localActions.get(evidence);
      const deadline = parseDeadline(evidence);
      return {
        action: evidence,
        deadline: deadline?.date || null,
        deadlineText: deadline?.text || null,
        priority: local?.priority || (deadline ? "High" : "Normal"),
        consequence: local?.consequence || "No consequence is explicitly stated in this notice.",
        consequenceEvidence: local?.consequenceEvidence || null,
        evidence
      };
    })
  };
}

async function requestGemini(parts) {
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: "Analyze notices accurately. Return only JSON with sourceText (the complete document text transcribed as faithfully as possible), summary (string), and actions (array of objects with action, deadline YYYY-MM-DD or null, deadlineText, priority High or Normal, consequence, evidence, consequenceEvidence). Every evidence value and non-null consequenceEvidence MUST be copied verbatim as one complete sentence from sourceText. Do not invent requirements, dates, or consequences; use null or an explicit no-consequence statement when absent." }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
    })
  });
  if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}: ${await response.text()}`);
  const result = await response.json();
  const output = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!output) throw new Error("Gemini response contained no analysis.");
  return JSON.parse(output);
}

async function analyze(text, role) {
  if (process.env.USE_AI !== "true") return analyzeNotice(text, role);
  if (!process.env.GEMINI_API_KEY) {
    console.warn("USE_AI=true but GEMINI_API_KEY is missing; using the local notice parser.");
    return analyzeNotice(text, role);
  }
  try {
    const parsed = await requestGemini([{ text: `Reader role: ${role}\n\nNOTICE:\n${text}` }]);
    return validateAnalysis(parsed, role, text);
  } catch (error) {
    console.error(`Gemini analysis failed; using local parser: ${error.message}`);
    return analyzeNotice(text, role);
  }
}

async function analyzeFile(buffer, mimeType, role) {
  if (process.env.USE_AI !== "true" || !process.env.GEMINI_API_KEY) {
    throw new Error("Set USE_AI=true and GEMINI_API_KEY to analyze PDF or image uploads. You can upload a text file without Gemini.");
  }
  const parsed = await requestGemini([
    { text: `Reader role: ${role}\n\nRead this uploaded notice, transcribe its text into sourceText, and create the personal action plan.` },
    { inlineData: { mimeType, data: buffer.toString("base64") } }
  ]);
  if (typeof parsed.sourceText !== "string" || !parsed.sourceText.trim()) {
    throw new Error("Gemini could not extract readable text from this upload. Try a clearer file or paste the notice text.");
  }
  return { ...validateAnalysis(parsed, role, parsed.sourceText), sourceText: parsed.sourceText.trim() };
}

module.exports = { analyze, analyzeFile };
