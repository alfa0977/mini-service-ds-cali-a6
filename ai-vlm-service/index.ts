import express from 'express';
import ZAI from 'z-ai-web-dev-sdk';

const PROMPT = `You are Cal-AI, a nutritionist vision AI. Analyze the meal in this image and estimate each ingredient with its weight in grams.

Rules:
- Identify distinct ingredients (not the whole dish as one item).
- Estimate weight in grams for each ingredient based on visual portion.
- If the image is not a meal/food, return an empty ingredients array with healthScore 0.
- Confidence is 0-1 (how sure you are about identification + weight).
- healthScore is 0-100 based on nutritional balance.
- Respond with ONLY a JSON object, no markdown, no prose.

JSON schema:
{
  "ingredients": [
    { "name": "string", "estimatedWeightGrams": number, "confidence": number }
  ],
  "healthScore": number,
  "mealTitle": "string (short, e.g. 'Pancakes with blueberries')",
  "detectedCategory": "Breakfast|Lunch|Dinner|Snack|Beverage"
}`;

let zaiInstance: Awaited<ReturnType<typeof ZAI.create>> | null = null;

async function getZai() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

// MACROS lookup (same as before)
const CATEGORY_MACROS: Record<string, { calories: number; protein: number; carbs: number; fat: number }> = {
  chicken: { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
  beef: { calories: 250, protein: 26, carbs: 0, fat: 17 },
  fish: { calories: 206, protein: 22, carbs: 0, fat: 12 },
  salmon: { calories: 208, protein: 20, carbs: 0, fat: 13 },
  egg: { calories: 155, protein: 13, carbs: 1.1, fat: 11 },
  tofu: { calories: 76, protein: 8, carbs: 1.9, fat: 4.8 },
  cheese: { calories: 402, protein: 25, carbs: 1.3, fat: 33 },
  milk: { calories: 42, protein: 3.4, carbs: 5, fat: 1 },
  yogurt: { calories: 59, protein: 10, carbs: 3.6, fat: 0.4 },
  rice: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  pasta: { calories: 158, protein: 5.8, carbs: 31, fat: 0.9 },
  bread: { calories: 265, protein: 9, carbs: 49, fat: 3.2 },
  potato: { calories: 77, protein: 2, carbs: 17, fat: 0.1 },
  salad: { calories: 15, protein: 1.4, carbs: 2.9, fat: 0.2 },
  tomato: { calories: 18, protein: 0.9, carbs: 3.9, fat: 0.2 },
  avocado: { calories: 160, protein: 2, carbs: 9, fat: 15 },
  broccoli: { calories: 34, protein: 2.8, carbs: 7, fat: 0.4 },
  oil: { calories: 884, protein: 0, carbs: 0, fat: 100 },
  honey: { calories: 304, protein: 0.3, carbs: 82, fat: 0 },
  default: { calories: 200, protein: 8, carbs: 25, fat: 8 },
};

function matchCategory(name: string): keyof typeof CATEGORY_MACROS {
  const n = name.toLowerCase().replace(/\s+/g, '');
  for (const key of Object.keys(CATEGORY_MACROS)) {
    if (n.includes(key)) return key as keyof typeof CATEGORY_MACROS;
  }
  return 'default';
}

function parseAnalysisResponse(raw: string) {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }
  const parsed = JSON.parse(text);

  let calories = 0, protein = 0, carbs = 0, fat = 0;
  for (const ing of parsed.ingredients ?? []) {
    const cat = matchCategory(ing.name ?? '');
    const m = CATEGORY_MACROS[cat];
    const grams = Number(ing.estimatedWeightGrams) || 0;
    calories += (m.calories * grams) / 100;
    protein += (m.protein * grams) / 100;
    carbs += (m.carbs * grams) / 100;
    fat += (m.fat * grams) / 100;
  }

  return {
    ingredients: (parsed.ingredients ?? []).map((ing: { name?: string; estimatedWeightGrams?: number; confidence?: number }) => ({
      name: String(ing.name ?? 'Unknown'),
      estimatedWeightGrams: Number(ing.estimatedWeightGrams) || 0,
      confidence: Math.min(1, Math.max(0, Number(ing.confidence) || 0.5)),
    })),
    macros: {
      calories: Math.round(calories),
      protein: Math.round(protein),
      carbs: Math.round(carbs),
      fat: Math.round(fat),
    },
    healthScore: Math.min(100, Math.max(0, Number(parsed.healthScore) || 0)),
    mealTitle: parsed.mealTitle ? String(parsed.mealTitle) : null,
    detectedCategory: parsed.detectedCategory ? String(parsed.detectedCategory) : null,
  };
}

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
// Health check endpoints
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'DS-Cali AI VLM service is running' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});
app.post('/', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: "Missing 'image'" });

    console.log(`[ai-vlm] Analyzing image (${image.length} chars)...`);

    const zai = await getZai();
    const response = await zai.chat.completions.createVision({
      // ✅ Added required 'model' field – use a valid vision model name
      model: 'z-ai-vision',  // or whatever the SDK expects (check docs)
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: image } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    });

    const raw = response.choices[0]?.message?.content ?? '';
    console.log(`[ai-vlm] Raw response: ${raw.slice(0, 200)}...`);

    const result = parseAnalysisResponse(raw);
    console.log(`[ai-vlm] Parsed: ${result.ingredients.length} ingredients, ${result.macros.calories} cal`);

    res.json(result);
  } catch (e) {
    console.error('[ai-vlm] Error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'Unknown error' });
  }
});

// Local development
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3031;
  app.listen(PORT, () => console.log(`🚀 Local: http://localhost:${PORT}`));
}

export default app;
