// Vercel Serverless Function - evalúa la conversación de práctica y entrega feedback estructurado.
// No requiere ninguna dependencia externa: usa fetch (incluido en Node 18+).

const FEEDBACK_CRITERIA = [
  {
    key: "apertura",
    title: "Apertura de la conversación",
    description:
      "¿Partió generando un clima adecuado (contexto, propósito, disposición a conversar) en vez de entrar abruptamente o a la defensiva?",
  },
  {
    key: "hechos",
    title: "Comunicación de los hechos / observaciones",
    description:
      "¿Describió hechos y observaciones concretas y verificables, evitando juicios, generalizaciones ('siempre', 'nunca') o interpretaciones presentadas como verdades?",
  },
  {
    key: "impacto",
    title: "Mostrar el impacto y compartir sentimientos o pensamientos",
    description:
      "¿Explicó el impacto concreto de la situación (en el trabajo, el equipo, la relación, etc.) y compartió, cuando correspondía, cómo le afectó o qué pensó, sin acusar?",
  },
  {
    key: "necesidades",
    title: "Comunicación de sus necesidades",
    description:
      "¿Fue claro/a respecto a qué necesita, qué le gustaría que pasara o qué está pidiendo, en vez de dejarlo implícito o esperar que la otra persona lo adivine?",
  },
  {
    key: "acuerdo",
    title: "Establecimiento de un acuerdo",
    description:
      "¿Buscó activamente llegar a un acuerdo concreto y explícito (qué se hará, cuándo, cómo se hará seguimiento), en vez de quedarse solo en el reclamo o la queja?",
  },
  {
    key: "cierre",
    title: "Cierre de la conversación",
    description:
      "¿Cerró la conversación de forma clara (resumen del acuerdo, agradecimiento, próximos pasos) en vez de dejarla inconclusa o cortarla abruptamente?",
  },
];

const FEEDBACK_TOOL = {
  name: "entregar_feedback",
  description:
    "Entrega la evaluación estructurada de la conversación de práctica según los 6 criterios del método sin demasiada exigencia.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description:
          "Evaluación de cada uno de los 6 criterios, en el mismo orden en que fueron listados.",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            score: { type: "integer", minimum: 0, maximum: 100 },
            comment: { type: "string" },
          },
          required: ["key", "score", "comment"],
        },
        minItems: 6,
        maxItems: 6,
      },
      average: {
        type: "integer",
        minimum: 0,
        maximum: 100,
        description: "Promedio final de los 6 puntajes, entero de 0 a 100.",
      },
      tips: {
        type: "array",
        description: "Exactamente 2 tips accionables para la próxima vez.",
        items: { type: "string" },
        minItems: 2,
        maxItems: 2,
      },
    },
    required: ["items", "average", "tips"],
  },
};

function buildSystemPrompt() {
  const criteriaList = FEEDBACK_CRITERIA.map(
    (c, i) => `${i + 1}. "${c.key}" — ${c.title}: ${c.description}`
  ).join("\n");

  return `Eres un coach experto en comunicación efectiva y conversaciones difíciles en el trabajo. Tu tarea es evaluar la transcripción de una conversación simulada que tuvo un/a participante de una capacitación, en la que practicó un desafío comunicacional siguiendo este método:

Preparación (antes de conversar):
1. ¿Qué quieren que pase?
2. ¿Qué necesitan decir con claridad?
3. ¿Qué necesitan entender de la otra persona?
4. ¿Qué quieren acordar?

Método para transmitirlo durante la conversación:
1. Observaciones / Hechos
2. Expresarse y mostrar impacto
3. Comprender la perspectiva de la otra persona
4. Transmitir necesidades y generar un acuerdo

Debes evaluar la conversación real (el rol del participante es "user"; el rol "assistant" es la otra persona simulada) en base a estos 6 criterios:
${criteriaList}

Para cada criterio entrega:
- Un puntaje de 0 a 100 (número entero, múltiplo de 5), donde 0 es "no se observó en absoluto" y 100 es "ejecutado de forma ejemplar".
- Un comentario breve (1 a 2 frases, en español, concreto y específico a lo que dijo o no dijo el participante) que explique el puntaje, usando tu conocimiento experto en comunicación.

Luego entrega:
- Un promedio final (0 a 100, entero) de los 6 puntajes.
- Exactamente 2 tips accionables y específicos (1 a 2 frases cada uno) para que el participante mejore la próxima vez, basados en los puntos más débiles de esta conversación.

Sé justo, específico y constructivo: reconoce lo que sí funcionó y sé concreto sobre lo que faltó, citando o parafraseando brevemente algo que el participante dijo cuando sea útil. Si la conversación fue muy corta o el participante casi no participó, refleja eso en puntajes bajos y coméntalo con honestidad pero con tono constructivo.

Debes responder EXCLUSIVAMENTE llamando a la herramienta "entregar_feedback" con el resultado estructurado. No escribas texto fuera de la llamada a la herramienta.`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({
      error: "Falta configurar la variable de entorno ANTHROPIC_API_KEY en Vercel.",
    });
    return;
  }

  try {
    const { setup, messages } = req.body || {};

    if (!setup || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "No hay suficiente conversación para evaluar." });
      return;
    }

    const transcript = messages
      .map((m) => `${m.role === "user" ? "Participante" : "Otra persona"}: ${m.content}`)
      .join("\n\n");

    const prep = setup.prep || {};
    const prepSummary = `
Preparación previa del participante:
1. Qué quiere que pase: ${prep.queQuierenQuePase || "(no especificado)"}
2. Qué necesita decir con claridad: ${prep.queNecesitanDecir || "(no especificado)"}
3. Qué necesita entender de la otra persona: ${prep.queNecesitasEntender || "(no especificado)"}
4. Qué quiere acordar: ${prep.queQuieresAcordar || "(no especificado)"}

Contexto de la situación: ${setup.context || "(no especificado)"}
Nivel de dificultad elegido: ${setup.difficulty || "(no especificado)"}
`.trim();

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5-20250929",
        max_tokens: 1800,
        system: buildSystemPrompt(),
        tools: [FEEDBACK_TOOL],
        tool_choice: { type: "tool", name: FEEDBACK_TOOL.name },
        messages: [
          {
            role: "user",
            content: `${prepSummary}\n\nTranscripción de la conversación practicada:\n\n${transcript}`,
          },
        ],
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      console.error("Anthropic API error:", data);
      res.status(500).json({
        error: data?.error?.message || "Error llamando a la API de Anthropic.",
      });
      return;
    }

    const toolUse = (data.content || []).find((block) => block.type === "tool_use");

    if (!toolUse) {
      res.status(502).json({ error: "No se pudo generar el feedback estructurado." });
      return;
    }

    const raw = toolUse.input || {};
    const titleByKey = Object.fromEntries(FEEDBACK_CRITERIA.map((c) => [c.key, c.title]));

    const items = (raw.items || []).map((it) => ({
      key: it.key,
      title: titleByKey[it.key] || it.key,
      score: Math.max(0, Math.min(100, Math.round(it.score))),
      comment: it.comment,
    }));

    const result = {
      items,
      average: Math.max(0, Math.min(100, Math.round(raw.average))),
      tips: [raw.tips?.[0] || "", raw.tips?.[1] || ""],
    };

    res.status(200).json(result);
  } catch (err) {
    console.error("feedback.js error:", err);
    res.status(500).json({ error: "Ocurrió un error generando el feedback. Intenta de nuevo." });
  }
};
