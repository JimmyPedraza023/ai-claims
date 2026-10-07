# Comparación de modelos de IA

> Prueba técnica AIX (Vacante 631). Medido el 6 de octubre de 2026 sobre el endpoint gratuito de NVIDIA (`integrate.api.nvidia.com`). Los modelos y los tiempos de un servicio gratuito cambian con la carga: son una fotografía de ese día, no una garantía.

## Para qué se mide

El sistema usa un modelo para dos tareas distintas: **clasificar el relato** del beneficiario (solo texto) y **leer los documentos** (imágenes). Cada una se configura por separado (`LLM_TEXT_MODEL` y `LLM_MODEL`). El modelo nunca decide: clasifica, extrae y sugiere. Esta medición busca el modelo que responda con un JSON válido y sin hacer esperar al caso.

## Método

- Un script temporal (`model-bench.mjs`), con la clave en `scripts/.env` (no se versiona).
- La misma instrucción de clasificación para todos y tres relatos de ejemplo: un accidente de tránsito, un infarto y un relato ambiguo («mi padre falleció el mes pasado»).
- Tres corridas por modelo; los modelos corren en paralelo y las corridas de cada uno, en serie.
- Temperatura 0, hasta 3.000 tokens de salida, tiempo máximo de 180 s (más que el del sistema, para ver el límite real del servidor).
- Una corrida es «válida» si la respuesta contiene un JSON que se puede leer. **No se mide si la clasificación es acertada.**

## Resultados (texto)

| Modelo | Válidas | Tiempos | Observaciones |
|---|---|---|---|
| `meta/muse-glimmer-30b` | 3/3 | 5 s, 9 s y 21 s (mediana ≈ 9 s) | Sin razonamiento; 236 a 297 tokens de salida |
| `moonshotai/kimi-k3` | 2/3 | 33 s y 39 s | La tercera corrida recibió un 429 (límite de peticiones) a los 0,4 s. Solo 75 a 86 tokens de salida: el tiempo se va en la cola del servicio, no en pensar |
| `deepseek-ai/deepseek-v4.1-flash` | 0/3 | los tres con timeout a los 180 s | Descartado por ahora |

## Lo que se vio en el sistema real (`ai_runs`)

Con `moonshotai/kimi-k3` dentro del worker, las llamadas tardaron entre 100 y 120 s. Las dos fallas de salida (una respuesta vacía y un JSON cortado a la mitad) ocurrieron a ≈ 109,5 s, casi al mismo tiempo, lo que sugiere un límite del servidor de ≈ 110 s: **es una hipótesis**, que el sistema ya puede confirmar porque ahora registra cómo terminó cada respuesta (`finish_reason`, tokens y latencia). Por eso subir el tiempo máximo del cliente no ayuda: hace falta que cada llamada tarde menos.

En ningún caso se perdió un trabajo: los reintentos con espera creciente absorbieron las fallas, cada llamada quedó registrada con su estado, y la prueba de extremo a extremo (`worker-pipeline.integration.spec.ts`) demuestra que, con el modelo apagado, todo queda para una persona.

El modelo respondió `indeterminado` ante «mi padre falleció» y `muerte_accidental` ante «accidente de tránsito», que es el comportamiento buscado: dudar cuando el relato no alcanza. Su confianza se agrupa en 0,85 a 0,95 y **no está calibrada**; por eso el umbral se ajusta con la tasa de correcciones de las personas, y se recalibra si cambia el modelo o el prompt.

## Decisión

| Tarea | Modelo | Motivo |
|---|---|---|
| Clasificar el relato (texto) | `meta/muse-glimmer-30b` | 3/3 válidas y mediana de ≈ 9 s, entre 4 y 10 veces más rápido que Kimi |
| Leer documentos (imágenes) | `moonshotai/kimi-k3`, por ahora | Es el único probado con una imagen. **Falta probar Muse y otros con imágenes** |

## Pendiente

1. **Prueba de visión** con tres documentos sintéticos (SARLAFT firmado, SARLAFT sin firma y cédula de otra persona), que luego pasan al conjunto de datos de prueba. Es la comparación que más importa: mide si el modelo ve una firma ausente, no solo si responde rápido.
2. **Medir acierto**, no solo formato: con los casos del conjunto de datos y la métrica de correcciones.
3. Fijar el modelo de documentos antes de grabar el video.

## Advertencias

- Un endpoint gratuito no ofrece garantías de disponibilidad ni límites estables. El diseño lo asume: el modelo se cambia con una variable de entorno, las llamadas se reintentan y, si fallan, la decisión pasa a una persona.
- En producción haría falta un proveedor con contrato y residencia de datos aprobada (en Azure, Azure OpenAI), detrás de la misma interfaz `LlmProvider`.
- Todos los datos de la prueba son sintéticos.