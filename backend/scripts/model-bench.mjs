// node --env-file=./scripts/.env .\scripts\model-bench.mjs [imagen.jpg]
// En scripts/.env:  NVIDIA_API_KEY=(la nueva)   MODELS=modelo-a,modelo-b,moonshotai/kimi-k3
//                   RUNS=3   EXTRA_BODY={"chat_template_kwargs":{"thinking":false}}   (opcional)
import { readFileSync } from 'node:fs';

const url = 'https://integrate.api.nvidia.com/v1/chat/completions';
const key = process.env.NVIDIA_API_KEY;
const models = (process.env.MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const runs = Number(process.env.RUNS ?? 3);
const extra = process.env.EXTRA_BODY ? JSON.parse(process.env.EXTRA_BODY) : {};
const image = process.argv[2] ? readFileSync(process.argv[2]).toString('base64') : null;

const TEXT_SYSTEM = 'Eres un asistente que clasifica reclamaciones de seguros de vida. Responde ÚNICAMENTE con JSON: {"claimType":{"value":"muerte_natural|muerte_accidental|incapacidad_total_permanente|indeterminado","confidence":0-1},"evidence":"máx 200 caracteres"}';
const CASES = [
  { text: 'Mi padre murió en un accidente de tránsito el 3 de septiembre.', expected: 'muerte_accidental' },
  { text: 'Mi esposo falleció de un infarto en su casa.', expected: 'muerte_natural' },
  { text: 'Mi padre falleció el mes pasado.', expected: 'indeterminado' },
];
const IMAGE_PROMPT = 'Describe el documento en JSON: {"tipo_documento":"...","legible":true|false,"firmado":true|false|null}';

async function call(model, messages) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 3000, stream: false, ...extra }),
      signal: AbortSignal.timeout(180_000), // más que nuestro corte, para ver el límite real del servidor
    });
    const body = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) return { ms, ok: false, note: `HTTP ${res.status}` };
    const data = JSON.parse(body);
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';
    let ok = false;
    try {
      const s = content.indexOf('{'), e = content.lastIndexOf('}');
      JSON.parse(content.slice(s, e + 1));
      ok = s >= 0 && e > s;
    } catch { /* ok queda en false */ }
    const think = data.usage?.completion_tokens_details?.reasoning_tokens ?? '-';
    return {
        ms,
        ok,
        content,
        note: `finish=${choice?.finish_reason} salida=${data.usage?.completion_tokens} razon=${think}`,
    };
  } catch (e) {
    return { ms: Date.now() - t0, ok: false, note: e.name };
  }
}

const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function bench(model) {
  const results = { texto: [], imagen: [] };

  // Pruebas de clasificación de texto
  for (let i = 0; i < runs; i++) {
    const c = CASES[i % CASES.length];

    const r = await call(model, [
      { role: 'system', content: TEXT_SYSTEM },
      { role: 'user', content: c.text },
    ]);

    results.texto.push(r);

    let value = null;

    try {
      const s = r.content.indexOf('{');
      const e = r.content.lastIndexOf('}');
      value = JSON.parse(r.content.slice(s, e + 1)).claimType?.value;
    } catch {
      // sin valor
    }

    console.log(
      `${model} · texto #${i + 1}: ${
        value === c.expected ? 'ACIERTA' : `DIFIERE (${value})`
      } ${r.ms} ms  ${r.note}`,
    );
  }

  // Pruebas de imagen, solo si se proporciona una
  if (image) {
    for (let i = 0; i < runs; i++) {
      const content = [
        { type: 'text', text: IMAGE_PROMPT },
        {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${image}`,
          },
        },
      ];

      const r = await call(model, [
        { role: 'user', content },
      ]);

      results.imagen.push(r);

      console.log(
        `${model} · imagen #${i + 1}: ${
          r.ok ? 'OK ' : 'FALLÓ'
        } ${r.ms} ms  ${r.note}`,
      );
    }
  }

  return results;
}

const all = await Promise.all(models.map(async (m) => [m, await bench(m)]));
console.log('\n=== RESUMEN ===');
for (const [m, r] of all) {
  for (const [kind, list] of Object.entries(r)) {
    if (!list.length) continue;
    console.log(`${m} · ${kind}: ${list.filter((x) => x.ok).length}/${list.length} válidas, mediana ${median(list.map((x) => x.ms))} ms`);
  }
}