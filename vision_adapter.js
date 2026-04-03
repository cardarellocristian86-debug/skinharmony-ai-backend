const axios = require("axios");
const { loadEnv } = require("../mail/load_env");

loadEnv();

function hasVisionSupport() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function extractStructuredText(responseData) {
  if (responseData.output_text) {
    return responseData.output_text;
  }

  if (!Array.isArray(responseData.output)) {
    return null;
  }

  for (const item of responseData.output) {
    if (!Array.isArray(item.content)) {
      continue;
    }

    for (const content of item.content) {
      if (content.type === "output_text" && content.text) {
        return content.text;
      }
      if (content.type === "text" && content.text) {
        return content.text;
      }
    }
  }

  return null;
}

function buildFallbackAnalysis(issue, area) {
  return {
    source: "fallback_local",
    probable_issue: issue || "non_determinato",
    probable_area: area || "non_determinata",
    confidence: "bassa",
    summary: "Lettura AI non disponibile. Analisi fotografica avanzata non attiva.",
    visible_signals: [
      "Foto acquisita ma non analizzata da un modello visivo remoto."
    ],
    limitation: "Per una lettura reale dell'immagine serve OPENAI_API_KEY e un endpoint pubblico."
  };
}

async function classifyImageWithAI({ imageDataUrl, declaredIssue, declaredArea }) {
  if (!hasVisionSupport()) {
    return buildFallbackAnalysis(declaredIssue, declaredArea);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const response = await axios.post(
    "https://api.openai.com/v1/responses",
    {
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: [
                "Sei un assistente SkinHarmony per pre-classificazione estetica non medica.",
                "Osserva solo i segnali visibili della foto.",
                "Non fare diagnosi mediche.",
                "Non inventare condizioni non osservabili.",
                "Restituisci JSON con chiavi: probable_issue, probable_area, confidence, summary, visible_signals.",
                "probable_issue deve essere uno tra: cellulite, lassita, texture, idratazione, sebo_scalp, cute_scalp, non_determinato.",
                "probable_area deve essere uno tra: viso, corpo, scalp, non_determinata.",
                "La summary deve essere sintetica e professionale in italiano.",
                "visible_signals deve essere una lista breve di segnali visivi, non interpretazioni cliniche."
              ].join(" ")
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Problematica dichiarata: ${declaredIssue || "non dichiarata"}. Zona dichiarata: ${declaredArea || "non dichiarata"}.`
            },
            {
              type: "input_image",
              image_url: imageDataUrl
            }
          ]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "skinharmony_photo_analysis",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              probable_issue: {
                type: "string",
                enum: [
                  "cellulite",
                  "lassita",
                  "texture",
                  "idratazione",
                  "sebo_scalp",
                  "cute_scalp",
                  "non_determinato"
                ]
              },
              probable_area: {
                type: "string",
                enum: [
                  "viso",
                  "corpo",
                  "scalp",
                  "non_determinata"
                ]
              },
              confidence: {
                type: "string",
                enum: ["bassa", "media", "alta"]
              },
              summary: { type: "string" },
              visible_signals: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: [
              "probable_issue",
              "probable_area",
              "confidence",
              "summary",
              "visible_signals"
            ]
          }
        }
      }
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      timeout: 30000
    }
  );

  const rawText = extractStructuredText(response.data);
  const output = rawText ? JSON.parse(rawText) : null;
  if (!output) {
    throw new Error("Nessuna risposta strutturata dal modello visivo.");
  }

  return {
    source: "openai_vision",
    ...output
  };
}

module.exports = {
  hasVisionSupport,
  classifyImageWithAI,
  buildFallbackAnalysis
};
