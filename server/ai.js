const { analyzeNotice } = require("./parser");

async function analyze(text, role) {
  if (process.env.USE_AI !== "true") return analyzeNotice(text, role);
  if (!process.env.GEMINI_API_KEY) {
    console.warn("USE_AI=true but GEMINI_API_KEY is missing; using the local notice parser.");
    return analyzeNotice(text, role);
  }
  try {
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: "Analyze notices accurately. Return only JSON with summary (string) and actions (array of objects with action, deadline YYYY-MM-DD or null, deadlineText, priority High or Normal, consequence, evidence, consequenceEvidence). Every evidence value and non-null consequenceEvidence MUST be copied verbatim as one complete sentence from the provided notice. Do not invent requirements, dates, or consequences; use null or an explicit no-consequence statement when absent." }] },
        contents: [{ role: "user", parts: [{ text: `Reader role: ${role}\n\nNOTICE:\n${text}` }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      })
    });
    if (!response.ok) throw new Error(`Gemini returned HTTP ${response.status}: ${await response.text()}`);
    const result = await response.json();
    const output = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
    if (!output) throw new Error("Gemini response contained no analysis.");
    const parsed = JSON.parse(output);
    if (!Array.isArray(parsed.actions) || typeof parsed.summary !== "string") throw new Error("Gemini response did not match the expected analysis format.");
    const sourceSentences = new Set(require("./parser").splitSentences(text));
    for (const action of parsed.actions) {
      if (!action.evidence || !sourceSentences.has(action.evidence)
        || (action.consequenceEvidence && !sourceSentences.has(action.consequenceEvidence))) {
        throw new Error("Gemini returned evidence that was not an exact sentence from the notice.");
      }
    }
    return {
      summary: parsed.summary,
      role,
      actions: parsed.actions.map((action) => ({
        action: String(action.action || action.evidence),
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(action.deadline || "") ? action.deadline : null,
        deadlineText: action.deadlineText ? String(action.deadlineText) : null,
        priority: action.priority === "High" ? "High" : "Normal",
        consequence: String(action.consequence || "No consequence is explicitly stated in this notice."),
        consequenceEvidence: action.consequenceEvidence || null,
        evidence: action.evidence
      }))
    };
  } catch (error) {
    console.error(`Gemini analysis failed; using local parser: ${error.message}`);
    return analyzeNotice(text, role);
  }
}

module.exports = { analyze };
