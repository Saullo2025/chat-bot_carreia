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

  const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1500;

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

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const geminiRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        const data = await geminiRes.json();

        if (data.error) {
          const code = data.error.code;
          const msg  = data.error.message || '';
          const isOverloaded = code === 429 || msg.includes('quota') || msg.includes('demand') || msg.includes('overloaded');

          if (isOverloaded) {
            // Se ainda tem tentativas, aguarda e tenta de novo no mesmo modelo
            if (attempt < MAX_RETRIES) {
              await sleep(RETRY_DELAY_MS * attempt);
              continue;
            }
            // Esgotou tentativas neste modelo, passa para o próximo
            break;
          }

          // Erro diferente (chave inválida etc.) — não adianta tentar
          return res.status(500).json({ error: data.error.message });
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return res.status(200).json({ text });

      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }
  }

  return res.status(503).json({
    error: 'Serviço temporariamente indisponível. Aguarde alguns segundos e tente novamente.'
  });
}
