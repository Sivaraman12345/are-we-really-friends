import { type DimensionScores, type Dimension, GeminiResultSchema } from "./types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function geminiUrl(): string {
  const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
  return `${GEMINI_BASE}/${model}:generateContent`;
}

/**
 * Generate a friendship result narrative using Gemini's structured output.
 * This is the ONLY AI call in the entire app — it fires once per test,
 * after both participants complete.
 */
export async function generateResultNarrative(
  scoresA: DimensionScores,
  scoresB: DimensionScores,
  bondScore: number,
  strongestDim: Dimension,
  mostDifferentDim: Dimension
): Promise<{ friendship_type: string; narrative: string }> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    // Fallback for when no API key is configured
    return getFallbackNarrative(bondScore, strongestDim, mostDifferentDim);
  }

  const prompt = buildResultPrompt(
    scoresA,
    scoresB,
    bondScore,
    strongestDim,
    mostDifferentDim
  );

  try {
    const response = await fetch(`${geminiUrl()}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              friendship_type: {
                type: "STRING",
                description:
                  "A catchy 2-5 word label for this friendship type, e.g. 'The Ride-or-Die Duo', 'Kindred Spirits', 'The Adventure Buddies'",
              },
              narrative: {
                type: "STRING",
                description:
                  "A warm, engaging 2-3 paragraph narrative describing this friendship's unique qualities, strengths, and what makes it special. Written in second person ('you two'). Fun and insightful, NOT clinical.",
              },
            },
            required: ["friendship_type", "narrative"],
          },
          temperature: 0.8,
          maxOutputTokens: 500,
        },
      }),
    });

    if (!response.ok) {
      console.error("Gemini API error:", response.status, await response.text());
      return getFallbackNarrative(bondScore, strongestDim, mostDifferentDim);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      return getFallbackNarrative(bondScore, strongestDim, mostDifferentDim);
    }

    const parsed = JSON.parse(text);
    const validated = GeminiResultSchema.parse(parsed);
    return validated;
  } catch (error) {
    console.error("Gemini call failed:", error);
    return getFallbackNarrative(bondScore, strongestDim, mostDifferentDim);
  }
}

function buildResultPrompt(
  scoresA: DimensionScores,
  scoresB: DimensionScores,
  bondScore: number,
  strongestDim: Dimension,
  mostDifferentDim: Dimension
): string {
  return `You are a warm, witty friendship analyst for a fun social app called "Are We Really Friends?"

Two friends just completed a friendship test. Here are their results:

Person A's scores (0-100):
${Object.entries(scoresA)
  .map(([dim, score]) => `  ${dim}: ${score}`)
  .join("\n")}

Person B's scores (0-100):
${Object.entries(scoresB)
  .map(([dim, score]) => `  ${dim}: ${score}`)
  .join("\n")}

Overall Bond Score: ${bondScore}/100
Strongest shared dimension: ${strongestDim}
Biggest difference: ${mostDifferentDim}

Write a result that:
1. Gives them a catchy friendship_type label (2-5 words, title case, fun and memorable)
2. Writes a narrative (2-3 paragraphs) that:
   - Highlights what makes their bond special
   - Mentions their strongest connection (${strongestDim}) specifically
   - Acknowledges their biggest difference (${mostDifferentDim}) in a positive, growth-oriented way
   - Feels personal, warm, and share-worthy — NOT like a horoscope or clinical assessment
   - Uses "you two" / "your friendship" — it's written TO them, not about them
   - Keep it under 200 words total`;
}

// ── Fallback Narratives ─────────────────────────────────────────────
// Used when Gemini is unavailable (no API key, rate limited, etc.)

const FRIENDSHIP_TYPES: Record<string, string> = {
  high_bond: "Kindred Spirits",
  medium_bond: "The Dynamic Duo",
  low_bond: "The Unlikely Pair",
};

const DIM_NAMES: Record<Dimension, string> = {
  trust: "trust",
  loyalty: "loyalty",
  empathy: "empathy",
  communication: "communication",
  adventure: "sense of adventure",
  conflict_handling: "conflict resolution",
  humor: "sense of humor",
};

function getFallbackNarrative(
  bondScore: number,
  strongestDim: Dimension,
  mostDifferentDim: Dimension
): { friendship_type: string; narrative: string } {
  let friendship_type: string;
  let intro: string;

  if (bondScore >= 80) {
    friendship_type = "Kindred Spirits";
    intro = `With a bond score of ${bondScore}%, you two are remarkably in sync.`;
  } else if (bondScore >= 60) {
    friendship_type = "The Dynamic Duo";
    intro = `A bond score of ${bondScore}% — you two bring out the best in each other.`;
  } else if (bondScore >= 40) {
    friendship_type = "The Balanced Pair";
    intro = `At ${bondScore}%, your friendship thrives on complementary strengths.`;
  } else {
    friendship_type = "The Unlikely Pair";
    intro = `A bond score of ${bondScore}% — your differences are what make this interesting.`;
  }

  const narrative = `${intro} Your strongest connection is in ${DIM_NAMES[strongestDim]} — it's the foundation that everything else is built on.

Where you differ most is ${DIM_NAMES[mostDifferentDim]}, and that's actually a gift. The best friendships aren't about being identical — they're about filling in each other's gaps. Your unique perspectives in this area give your friendship depth that many people never find.`;

  return { friendship_type, narrative };
}
