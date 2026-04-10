export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Chave da API não configurada no servidor.' });
  }

  const { history, message, systemPrompt } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'Mensagem não informada.' });
  }

  // Ordem de fallback: tenta cada modelo até um funcionar
  const MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
  ];

  const contents = [
    ...(history || []),
    { role: 'user', parts: [{ text: message }] }
  ];

  const body = {
    contents,
    generationConfig: { maxOutputTokens: 1000, temperature: 0.7 }
  };

  if (systemPrompt) {
    body.system_instruction = { parts: [{ text: systemPrompt }] };
  }

  let lastError = '';

  for (const model of MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const geminiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await geminiRes.json();

      // Se for erro de quota ou sobrecarga, tenta o próximo modelo
      if (data.error) {
        const code = data.error.code;
        const msg  = data.error.message || '';
        if (code === 429 || msg.includes('quota') || msg.includes('demand') || msg.includes('overloaded')) {
          lastError = `${model}: ${msg}`;
          continue; // tenta próximo modelo
        }
        // Erro diferente (ex: chave inválida) — não adianta tentar outros modelos
        return res.status(500).json({ error: data.error.message });
      }

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return res.status(200).json({ text, model }); // retorna qual modelo foi usado

    } catch (err) {
      lastError = err.message;
      continue;
    }
  }

  // Todos os modelos falharam
  return res.status(503).json({
    error: 'Todos os modelos estão sobrecarregados no momento. Tente novamente em alguns instantes.'
  });
}
