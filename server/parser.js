const ACTION_WORDS = /\b(submit|send|pay|register|complete|provide|upload|attend|respond|reply|renew|bring|return|contact|schedule|book|apply|collect|visit|sign|fill(?:\s+out)?|ensure|must|need(?:s)?\s+to|required\s+to|should)\b/i;
const CONSEQUENCE_WORDS = /\b(fail(?:ure)?|otherwise|late fee|penalt(?:y|ies)|cancel(?:led|lation)?|suspend(?:ed|sion)?|lose|forfeit|ineligible|denied|disqualif(?:ied|ication)|not be accepted|may result|will result|liable|termination|eviction|additional charge)\b/i;
const DATE_PATTERNS = [
  /\b(?:by|before|on|due(?:\s+date)?(?:\s+is)?|no later than|until)\s+(?:the\s+)?(?:(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s*,?\s*(20\d{2}))?|(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(20\d{2}|\d{2}))?|((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,?\s+20\d{2})?))/i,
  /\b(?:by|before|within)\s+(today|tomorrow|this\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|next\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\b/i
];
const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11
};

function parseDeadline(sentence, now = new Date()) {
  const match = DATE_PATTERNS.map((pattern) => sentence.match(pattern)).find(Boolean);
  if (!match) return null;
  const text = match[0];
  let date;
  const numeric = text.match(/(\d{1,2})\s*[/-]\s*(\d{1,2})(?:\s*[/-]\s*(20\d{2}|\d{2}))?/);
  const named = text.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s*,?\s*(20\d{2}))?/i)
    || text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s+(20\d{2}))?/i);
  if (numeric) {
    let year = numeric[3] ? Number(numeric[3]) : now.getFullYear();
    if (year < 100) year += 2000;
    date = new Date(Date.UTC(year, Number(numeric[1]) - 1, Number(numeric[2])));
  } else if (named) {
    const day = Number(named[1].match(/\d+/)?.[0] || named[2]);
    const month = MONTHS[(named[1].match(/[A-Za-z]+/)?.[0] || named[1]).toLowerCase()];
    const yearText = named[3];
    let year = yearText ? Number(yearText) : now.getFullYear();
    date = new Date(Date.UTC(year, month, day));
    if (!yearText && date < new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))) {
      date.setFullYear(year + 1);
    }
  } else {
    const relative = text.match(/today|tomorrow|this\s+(\w+)|next\s+(\w+)/i);
    date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    if (/tomorrow/i.test(text)) date.setUTCDate(date.getUTCDate() + 1);
    else if (/this\s+|next\s+/i.test(text)) {
      const dayName = (relative[1] || relative[2]).toLowerCase();
      const target = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(dayName);
      let delta = (target - date.getUTCDay() + 7) % 7;
      if (/next\s+/i.test(text) && delta === 0) delta = 7;
      date.setUTCDate(date.getUTCDate() + delta);
    }
  }
  if (!date || Number.isNaN(date.getTime())) return null;
  const requestedDay = numeric ? Number(numeric[2]) : (named ? Number(named[1].match(/\d+/)?.[0] || named[2]) : null);
  if (requestedDay && (date.getUTCDate() !== requestedDay
    || date.getUTCMonth() !== (numeric ? Number(numeric[1]) - 1 : MONTHS[(named[1].match(/[A-Za-z]+/)?.[0] || named[1]).toLowerCase()]))) return null;
  return { text, date: date.toISOString().slice(0, 10) };
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|[\r\n]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function analyzeNotice(text, role = "Student") {
  const sentences = splitSentences(text);
  const actions = [];
  const actionRoots = (sentence) => {
    const matches = sentence.match(/\b(register(?:ed|ing)?|registration|submit(?:ted|ting)?|pay(?:ing|ment)?|renew(?:ed|al|ing)?|apply|application|attend(?:ed|ing|ance)?)\b/gi) || [];
    return new Set(matches.map((word) => word.toLowerCase().replace(/registration|registered|registering/g, "register")));
  };
  for (const sentence of sentences) {
    const deadline = parseDeadline(sentence);
    const actionable = ACTION_WORDS.test(sentence);
    const datedRequirement = deadline && /\b(due|deadline|payment|registration|application|form|document|fee|respond|renew|complete|submit|pay)\b/i.test(sentence);
    if (!actionable && !datedRequirement) continue;
    if (/\b(?:who|that)\s+(?:do not|don't|does not|doesn't|did not|didn't)\s+(?:submit|send|pay|register|complete|provide|upload|attend|respond|reply|renew|bring|return|contact|schedule|book|apply|collect|visit|sign|fill|ensure)\b/i.test(sentence)) continue;
    if (CONSEQUENCE_WORDS.test(sentence) && /^\s*(?:failing|failure)\s+to\s+(?:submit|send|pay|register|complete|provide|upload|attend|respond|reply|renew|bring|return|contact|schedule|book|apply|collect|visit|sign|fill)\b/i.test(sentence)) continue;
    const highPriority = /\b(urgent|immediately|as soon as possible|within\s+\d+\s+days|deadline|must|required)\b/i.test(sentence);
    const roots = actionRoots(sentence);
    const consequenceSentence = sentences.find((item) =>
      CONSEQUENCE_WORDS.test(item)
      && [...roots].some((root) => actionRoots(item).has(root))
    );
    const consequenceEvidence = CONSEQUENCE_WORDS.test(sentence) ? sentence : (consequenceSentence || null);
    const consequence = consequenceEvidence || "No consequence is explicitly stated in this notice.";
    actions.push({
      action: sentence.replace(/^[\s•*-]+/, ""),
      deadline: deadline?.date || null,
      deadlineText: deadline?.text || null,
      priority: highPriority || deadline ? "High" : "Normal",
      consequence,
      consequenceEvidence,
      evidence: sentence
    });
  }
  const roleText = `${role.toLowerCase()}-focused`;
  const summary = actions.length
    ? `This notice has ${actions.length} ${actions.length === 1 ? "action" : "actions"} to take. Review the deadlines and complete the ${roleText} requirements below.`
    : `No clear action was detected for a ${roleText} reader. Review the notice carefully; you can still use the original text as your reference.`;
  return { summary, actions, role };
}

module.exports = { analyzeNotice, splitSentences, parseDeadline };
