// nvidia-smoke.mjs
// Ejecutar:
// node --env-file=./scripts/.env .\scripts\nvidia-smoke.mjs [imagen.jpg]

import { readFileSync } from "node:fs";

const url = "https://integrate.api.nvidia.com/v1/chat/completions";
const key = process.env.NVIDIA_API_KEY;
const model = process.env.NVIDIA_MODEL;

async function call(name, content) {
  const t0 = Date.now();
  const controller = new AbortController();

  // Evita esperar varios minutos si NVIDIA no responde.
  const timeout = setTimeout(() => {
    controller.abort();
  }, 60_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 300,
        reasoning_effort: "low",
        messages: [{ role: "user", content }],
      }),
      signal: controller.signal,
    });

    const body = await res.text();

    console.log(
      `\n== ${name} == status ${res.status} · ${Date.now() - t0} ms`,
    );

    console.log("body:", body.slice(0, 1500));

    if (!body) {
      console.error("La API devolvió una respuesta vacía.");
      return;
    }

    let data;

    try {
      data = JSON.parse(body);
    } catch {
      console.error("La respuesta no es JSON válido.");
      return;
    }

    console.log(
      "message:",
      JSON.stringify(data.choices?.[0]?.message, null, 2).slice(0, 1500),
    );

    console.log("usage:", data.usage);
  } catch (error) {
    if (error.name === "AbortError") {
      console.error(
        `La petición superó el timeout de 60 segundos.`,
      );
    } else {
      console.error("Error realizando la petición:", error);
    }
  } finally {
    clearTimeout(timeout);
  }
}

await call(
  "texto -> JSON",
  'Responde SOLO con JSON {"tipo":"muerte_natural|muerte_accidental|incapacidad","confianza":0-1}. Texto: "Mi papá murió ayer de un infarto en la casa."',
);

if (process.argv[2]) {
  const b64 = readFileSync(process.argv[2]).toString("base64");

  await call("imagen", [
    {
      type: "text",
      text: 'Describe en JSON {"tipo_documento":"...","legible":true|false}',
    },
    {
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${b64}`,
      },
    },
  ]);
}