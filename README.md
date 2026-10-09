# Radicación de reclamaciones de seguros de vida

Prueba técnica · Desarrollador Junior IA y Automatización · Frente AIX · Global Seguros de Vida S.A. · Vacante 631

Una versión pequeña del trabajo real: un beneficiario radica una reclamación sin crear usuario, un modelo de IA clasifica y lee los documentos, el código decide si el expediente está completo, el reloj legal del artículo 1080 del Código de Comercio arranca y se vigila solo, y una persona decide pagar, objetar o pedir más documentos.

> **Todos los datos son sintéticos.** Nada de lo que hay aquí usa cifras ni documentos reales de la compañía. Los derechos del código y la documentación son de su autor.

---

## 1. Acceso rápido para quien evalúa

| Qué | Dónde |
|---|---|
| **Canal de radicación** (página pública, sin usuario) | [COMPLETAR: URL del frontend desplegado] |
| **Panel del analista** | [COMPLETAR: URL]`/panel/login` |
| **Usuario de prueba del panel** | [COMPLETAR: correo y contraseña] |
| **Las cuatro respuestas** | Panel → **Métricas** (ver sección 5) |
| **Video de 5 minutos** | [COMPLETAR: enlace] |
| **Conjunto de datos de prueba** | Carpeta [`data/`](./data) (ver sección 9) |

**Cómo probar el flujo completo en 3 minutos**

1. Abre el canal de radicación y radica una reclamación con uno o dos documentos. El mensaje de éxito es idéntico en todos los casos (nuevo, repetido o anexado), a propósito: ver sección 7.
2. El beneficiario recibe un correo con el enlace de seguimiento. [COMPLETAR: cómo se ve ese correo en el entorno desplegado].
3. Abre el enlace: ves qué documentos están recibidos, cuáles se están revisando, cuáles faltan y cuáles llegaron pero no sirven, con qué hacer en cada caso. Desde ahí se suben los pendientes.
4. Entra al panel con el usuario de prueba. El caso aparece con su semáforo del reloj. Ábrelo: ves qué determinó el sistema y con qué información, y registras la decisión.

---

## 2. Qué hace y cómo está armado

Tres piezas, como pide el enunciado:

| Pieza | Qué es |
|---|---|
| **Canal de radicación** | Página web pública, mobile-first, sin crear cuenta. Formulario corto, carga de documentos con cámara o galería, y una página de seguimiento por enlace personal. |
| **Motor** | API (NestJS) y un **worker** aparte. La API guarda primero; el worker analiza documentos con el modelo, clasifica el tipo de reclamación, evalúa la completitud y arranca el reloj. |
| **Panel del analista** | Vista interna con login: casos ordenados por urgencia, día del plazo, lo que determinó el sistema, y el registro de la decisión humana. |

```
Beneficiario ──► POST /intake ──► PostgreSQL (caso, documentos, bitácora, cola de trabajos)
                  (captcha, límite,              │
                   validación de archivos)       ▼
                                          Worker (proceso aparte)
                                          ├─ analizar_documento    ─► modelo (visión)
                                          ├─ clasificar_reclamacion ─► modelo (texto)
                                          └─ evaluar_completitud   ─► función pura ─► arranca el reloj
                                                     │
Beneficiario ◄── GET /tracking ◄─────────────────────┤  (lo que ve: qué falta, qué no sirve)
                                                     ▼
Analista ──► Panel (login JWT) ──► detalle del caso ──► decisión humana (queda quién, cuándo y con qué evaluación)
```

### Stack

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript en todo el proyecto |
| Backend | NestJS 12 · Node 22 · validación con Zod 4 |
| Frontend | React 19 · Vite · Tailwind 4 · React Router |
| Base de datos | PostgreSQL (SQL puro, migraciones solo hacia adelante) |
| Cola de trabajos | En PostgreSQL (`SELECT … FOR UPDATE SKIP LOCKED`), sin Redis |
| IA | LLM gratuito de NVIDIA detrás de la interfaz propia `LlmProvider` |
| Captcha | Cloudflare Turnstile |
| Pruebas | Jest, SWC, `@nestjs/testing`, `supertest`, contra PostgreSQL real |

### Por qué una página web como canal

El enunciado deja elegir (página, WhatsApp, Telegram o una combinación). Elegí **una sola página web pública** porque quien radica acaba de perder a un familiar y necesita ver todo en una pantalla: un formulario corto, un lugar claro para adjuntar documentos y, después, una página donde ver qué falta sin tener que preguntar. Un bot obliga a recordar un hilo de conversación; una página con un enlace personal se puede abrir, cerrar y retomar. Además permite validar archivos y aplicar captcha con más control. Un segundo canal queda fuera de alcance (ver sección 11).

---

## 3. Las cuatro condiciones que no se negocian

| Condición | Cómo se cumple | Dónde mirar |
|---|---|---|
| **El reloj no se pierde** | El día del plazo se calcula al vuelo desde la fecha de completitud, no se acumula, así que un fallo en la vigilancia no pierde nada. El reloj es inmutable en la base (CHECK + trigger). Semáforo en el panel; "en riesgo" con 7 días o menos. | `modules/legal-clock`, `fn_claim_clock()`, panel → Casos |
| **El modelo no decide** | El modelo solo puede elegir valores de listas cerradas y no existe forma de expresar "completo" ni "pagar". La completitud es una función pura. No hay ninguna columna de monto de indemnización. Las decisiones exigen usuario y motivo, y son de solo inserción. | `modules/classification`, `modules/completeness`, `modules/decisions` |
| **Todo caso se puede reconstruir** | Bitácora de solo inserción escrita en la misma transacción del hecho. Cada llamada al modelo queda en `ai_runs`. Cada evaluación en `completeness_evaluations`. | `claim_events`, `v_claim_timeline`, panel → Historial |
| **El mismo documento dos veces no es un caso nuevo** | Llave de idempotencia, SHA-256 por archivo y por caso, **un solo caso abierto por beneficiario + asegurado**. Los envíos simultáneos los resuelve la base con índices únicos (probado con peticiones concurrentes). Un duplicado no crea un expediente ni reinicia el reloj. | `modules/intake`, `modules/documents`, pruebas de integración |

### Reglas del negocio

| Tipo de reclamación | El expediente está completo cuando tiene |
|---|---|
| Muerte natural | Formato de reclamación · Registro civil de defunción · Certificado médico de defunción · Documento de identidad del asegurado · Documento de identidad del beneficiario · Formulario SARLAFT firmado · Certificación bancaria |
| Muerte accidental | Todo lo anterior + informe de la autoridad competente |
| Incapacidad total y permanente | Formato de reclamación · Dictamen de pérdida de capacidad laboral · Historia clínica resumida · Documento de identidad del asegurado · Formulario SARLAFT firmado · Certificación bancaria |

- **El reloj corre desde que el expediente queda completo**, no desde la primera radicación. Llega incompleto el 1 de octubre y se completa el 20: vence el 20 de noviembre.
- **Un documento puede llegar y no servir** (SARLAFT sin firma, foto ilegible, cédula que no corresponde al asegurado). Es distinto de "falta" y al beneficiario se le explica distinto. El expediente no queda completo porque el archivo exista.
- Reloj: mes calendario, hora de Colombia, el último día cuenta como a tiempo.

---

## 4. La frontera entre el modelo y la persona

Esta es la decisión de diseño central.

> **El modelo extrae y sugiere. El código decide la completitud y el reloj. Toda decisión de pago es humana y queda registrada.**

- **El modelo clasifica y lee.** Tipo de reclamación (a partir del relato), tipo de cada documento, legibilidad, firma y coincidencia con el asegurado. Siempre con confianza por campo y con `null` cuando no sabe.
- **Ante cualquier duda, una persona.** Hay umbrales por campo; por debajo, el documento queda `en_revision`. Con más de 4 páginas, ningún veredicto es firme porque la firma podría estar en una página que no se vio.
- **El texto libre del modelo nunca llega al beneficiario.** Los mensajes salen de códigos de motivo fijos (`sin_firma`, `ilegible`, `no_corresponde_asegurado`…).
- **El tipo de reclamación solo se escribe con confianza ≥ 0,85 y si estaba vacío.** Lo que fijó una persona no lo toca el modelo; si el modelo cambia de opinión, va a revisión.
- **El sistema no calcula el valor de la indemnización** ni decide pagar u objetar. En el panel, la decisión pasa por un paso de confirmación y queda a nombre de quien la toma.

---

## 5. Las cuatro preguntas y dónde verlas

Calculadas en vivo desde la base, con lo que realmente pasó. Panel → **Métricas**.

| # | Pregunta | Endpoint (con sesión) | Origen en la base |
|---|---|---|---|
| 1 | ¿Cuántos casos abiertos, en qué día del plazo, cuántos en riesgo y cuántos vencidos? | `GET /panel/metrics/clock` | `fn_claim_clock()` |
| 2 | De las clasificaciones del modelo, ¿cuántas corrigió una persona? | `GET /panel/metrics/model-corrections` | `v_model_correction_rate` |
| 3 | ¿Cuánto se demora desde la radicación hasta decirle al beneficiario qué le falta? (hoy: 4,5 días) | `GET /panel/metrics/first-response` | `v_first_response` |
| 4 | Un caso al azar: ¿se puede reconstruir su historia completa? | `GET /panel/metrics/random-timeline` | `v_claim_timeline` |

Decisiones de honestidad en las métricas:

- **Pregunta 2:** separa «confirmó», «corrigió» y «se abstuvo». Que el modelo dude y envíe el caso a una persona no es un error. Si nadie ha revisado nada, el tablero dice que todavía no se puede afirmar que el modelo sirva, en vez de mostrar 0 %.
- **Pregunta 3:** los casos sin respuesta no se esconden dentro del promedio: se cuentan aparte y se reporta cuánto lleva esperando el más antiguo.
- **Pregunta 4:** además de mostrar un caso al azar, cuenta los casos sin ningún evento en la bitácora. Debe ser siempre 0.

Consulta directa a la base:

```sql
SELECT * FROM fn_claim_clock();
SELECT * FROM v_model_correction_rate;
SELECT * FROM v_first_response;
SELECT * FROM v_claim_timeline WHERE claim_id = '<id>' ORDER BY event_id;
```

---

## 6. Cómo levantar todo desde cero

### Requisitos

- Node.js **22**
- Docker (para PostgreSQL)
- Una clave de la API gratuita de NVIDIA (`NVIDIA_API_KEY`), solo para el worker
- Opcional: [Mailpit](https://github.com/axllent/mailpit) para ver los correos en desarrollo

### 1. Base de datos

```bash
docker compose -f infra/docker-compose.yml up -d
```

[COMPLETAR: confirmar que este compose levanta PostgreSQL y, si lo trae, Mailpit. Si no trae Mailpit: `docker run -d -p 1025:1025 -p 8025:8025 axllent/mailpit`.]

### 2. Backend

```bash
cd backend
cp .env.example .env          # en PowerShell: Copy-Item .env.example .env
npm install
npm run db:migrate            # aplica las migraciones
npm run start:dev             # API en http://localhost:3000
```

En **otra terminal**, el worker (proceso aparte, necesita `NVIDIA_API_KEY` en el `.env`):

```bash
cd backend
npm run start:worker:dev
```

Sin worker, los casos se guardan pero nunca salen de «revisando»: es el comportamiento diseñado (guardar primero, procesar después).

**Usuario de prueba del panel:** [COMPLETAR: comando del seed, correo y contraseña].

**Correo en desarrollo:** si `SMTP_HOST` está definido, el enlace de seguimiento se envía por correo (con Mailpit, se ve en http://localhost:8025). Si no está definido, el enlace se imprime en el log de la API como `[solo desarrollo] RC-…: /seguimiento#<token>`.

#### Variables de entorno

La lista completa y comentada está en `backend/.env.example`. Las principales:

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión de la API |
| `DATABASE_SSL` · `DATABASE_POOL_MAX` | No | SSL (Supabase lo exige) y tamaño del pool |
| `STORAGE_DIR` | No | Carpeta del almacenamiento local de archivos |
| `CORS_ORIGINS` | En producción | Orígenes permitidos, separados por coma. En desarrollo debe incluir `http://localhost:5173` |
| `IP_HASH_SECRET` | En producción | Secreto (mín. 16 caracteres) para el HMAC de la IP. La IP nunca se guarda |
| `TURNSTILE_SECRET_KEY` | En producción | Sin ella el captcha se desactiva y se avisa al arrancar. En desarrollo: `1x0000000000000000000000000000000AA` (siempre aprueba) |
| `NVIDIA_API_KEY` | Solo el worker | La API no la necesita; el worker no arranca sin ella |
| `LLM_MODEL` · `LLM_TEXT_MODEL` | No | Modelo para documentos (visión) y para clasificar el relato (texto) |
| `LLM_TIMEOUT_MS` · `LLM_MAX_TOKENS` | No | Tiempo máximo de una llamada (120 000) y tope de tokens de salida (3 000) |
| `WORKER_CONCURRENCY` · `WORKER_POLL_MS` | No | Trabajos en paralelo (2) y espera entre búsquedas (2 000 ms) |
| `JOB_TIMEOUT_MS` · `JOB_LEASE_SECONDS` | No | Tiempo máximo de un trabajo (150 000) y reserva (210). Se valida al arrancar que reserva > trabajo > modelo |
| `PORT` · `LOG_LEVEL` · `NODE_ENV` | No | Puerto, nivel de logs y entorno |

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev                   # http://localhost:5173
```

| Variable | Valor en desarrollo |
|---|---|
| `VITE_API_URL` | `http://localhost:3000` |
| `VITE_TURNSTILE_SITE_KEY` | `1x00000000000000000000AA` (clave pública de prueba de Cloudflare; solo funciona con la clave secreta de prueba del backend) |

Rutas: `/` (radicar) · `/seguimiento#<token>` · `/panel/login` · `/panel` · `/panel/casos/:id` · `/panel/metricas`.

### 4. Pruebas

Desde `backend/`:

| Comando | Para qué |
|---|---|
| `npm test` | Pruebas unitarias (no necesitan base de datos) |
| `npm run db:migrate:test` | Migraciones de la base de pruebas (`*_test`, variables en `.env.test`) |
| `npm run test:integration` | Pruebas contra PostgreSQL real, incluidas las HTTP con `supertest` |
| `npx tsc --noEmit` | Revisión de tipos |
| `npm run build` | Compila y copia los `.sql` a `dist/` |

Qué cubren: idempotencia con envíos simultáneos, archivo falso, tamaño y cantidad, token inválido, límite de peticiones, captcha, subida desde el seguimiento, política de veredictos (con el invariante «bajo su umbral, nunca válido»), proveedor del modelo con respuestas falsas (429, 500, 401, red, timeout, salida cortada o vacía), cola de trabajos (dos workers a la vez, lease vencido, cercado, reintentos), preparación de documentos (PDF real, límite de páginas, archivo corrupto) y los handlers contra la base con un modelo falso (`FakeLlmProvider`).

Desde `frontend/`: `npm run build` y `npm run lint`.

---

## 7. Seguridad

El canal está abierto a cualquiera y recibe archivos de desconocidos. El panel no.

### Canal público

| Medida | Detalle |
|---|---|
| **Tres capas antes de leer los archivos** | Límite de peticiones por IP → captcha Turnstile (token de un solo uso) → validación de los archivos. Los guards van antes de multer, que carga los archivos en memoria. |
| **Archivos validados por contenido** | El tipo se decide por los primeros bytes (PDF, JPEG, PNG, WebP), nunca por la extensión. Máx. 10 MB por archivo y 10 por envío. La ruta de almacenamiento se arma con el hash, nunca con el nombre que envía la persona. Un archivo malo rechaza el envío completo. |
| **Seguimiento sin cuenta** | Token de 256 bits; en la base solo se guarda su hash. Viaja en la cabecera `x-tracking-token`, **nunca en la URL** (las URL quedan en los logs). El enlace del correo lleva el token en el fragmento (`#<token>`), que el navegador no envía a ningún servidor. Página con `Referrer-Policy: no-referrer`. |
| **No se puede averiguar si existe un caso** | La respuesta de radicar es idéntica para caso nuevo, anexado y repetido (`202`, mismo mensaje). Token ausente, mal formado o inexistente: el mismo `404`. |
| **Privacidad** | La IP solo se guarda como HMAC con secreto del entorno. La bitácora no guarda datos personales en el esquema de eventos. |
| **El modelo como superficie de ataque** | Los datos del relato y de los nombres van entre etiquetas declaradas como datos y se eliminan `<` y `>`. Aunque un documento le dé órdenes al modelo, su salida solo puede ser un valor de una lista cerrada, y la completitud la calcula el código. |

### Panel

| Medida | Detalle |
|---|---|
| **Todo detrás del login** | JWT de vida corta (1 hora). El guard va a nivel de clase en cada controlador, para que no se pueda olvidar en un método. Login limitado a 5 intentos por minuto. |
| **Contraseñas** | Hash, nunca en claro. |
| **Archivos de los beneficiarios** | Se sirven solo con sesión, con `Content-Security-Policy: default-src 'none'; sandbox`, `X-Content-Type-Options: nosniff` y `Cache-Control: no-store`. El nombre del archivo se arma con el id, no con el original. El frontend los pide con `fetch` y los abre desde memoria, porque un enlace directo no manda la sesión. |
| **Sesión en el navegador** | `sessionStorage`: se pierde al cerrar la pestaña. Cualquier `401` limpia la sesión y vuelve al login. |
| **Base de datos** | RLS activo en todas las tablas. Las reglas críticas las hace cumplir la base (CHECK, triggers, índices únicos), no solo el código. |

### Límites conocidos

- El contador del límite de peticiones está **en memoria**: con más de una instancia hay que pasarlo a un almacenamiento compartido.
- **No hay antivirus** de archivos. Siguiente paso documentado.
- **pdfjs dibuja los PDF en el mismo proceso** del worker. Hay topes de páginas, tamaño y píxeles, pero un dibujo colgado no se detiene a la fuerza. Siguiente paso: un hilo o proceso aparte.
- Los documentos se envían a un **proveedor de IA de terceros, gratuito y sin SLA**. Aquí los datos son sintéticos; en producción haría falta un proveedor con contrato y residencia de datos aprobada.
- Si Cloudflare no responde pero el navegador ya obtuvo un token, se deja pasar y se registra el error; si el widget ni siquiera cargó, se rechaza. Es una decisión entre disponibilidad y protección, y cambiarla es una línea.

---

## 8. Inteligencia artificial

| Tema | Qué se hizo |
|---|---|
| **Para qué sirve el modelo** | Hace un trabajo real: infiere el tipo de reclamación del relato y juzga cada documento (tipo, legibilidad, firma, coincidencia con el asegurado). El beneficiario nunca elige el tipo. |
| **PDF y fotos como imágenes** | Todo documento llega al modelo como imágenes JPEG: un PDF se dibuja página por página (máx. 4) y una foto se reduce a 1600 px. Lo que más importa (una firma, un sello, una foto borrosa) no aparece en el texto extraído. Un solo camino de código. |
| **Control de lo que se inventa** | Vocabulario cerrado validado con Zod; todo lo demás es `invalido`. Confianza por campo. Umbrales iniciales: tipo de documento 0,8 · legibilidad 0,7 · firma 0,8 · coincidencia con el asegurado 0,8 · tipo de reclamación 0,85. Son valores de partida: la confianza del modelo no está calibrada y se recalibra con la tasa de correcciones. |
| **Qué pasa cuando no responde** | La radicación ya está guardada. Los trabajos se reintentan con espera creciente (30 s, 60 s, 120 s… tope 15 min; mínimo 60 s tras un 429). En el último intento, el documento pasa a `requiere_revision` y el caso sin tipo queda visible para una persona. Nada se queda «pendiente» para siempre. |
| **Evidencia real** | Con el modelo gratuito se observaron llamadas de 100 a 120 s, cortes a ≈ 110 s y un `429`. `ai_runs` lo registra y ningún caso se perdió. |
| **Sin transacciones largas** | Nunca hay una transacción abierta mientras el modelo responde (≈ 50 s por llamada): se lee, se llama al modelo y se escribe todo en una transacción corta. |
| **Registro** | Cada llamada, también la fallida, queda en `ai_runs` con modelo, versión del prompt, latencia y estado. `input_ref` guarda ids, hash y tamaños, nunca contenido. Los prompts están versionados (`prompts-v1`). |
| **Medición** | Por documento se guardan dos predicciones (tipo y validez), para que la métrica de correcciones no esconda el error grave («dijo que estaba firmado y no lo estaba»). |
| **Elección del modelo** | Se midió, no se supuso: mismo prompt, tres corridas, en paralelo. Ver [`docs/MODEL_BENCHMARK.md`](./docs/MODEL_BENCHMARK.md). El benchmark mide formato y latencia, no acierto: el acierto lo mide la tasa de correcciones. |
| **Dos modelos** | Texto (clasificar el relato) y visión (documentos) se configuran por separado: clasificar un relato no necesita visión y el modelo más rápido baja la latencia. |

---

## 9. Conjunto de datos de prueba

Carpeta [`data/`](./data). Mínimo 30 radicaciones, todas sintéticas (PDF e imágenes generados, nunca datos reales).

Casos que debe cubrir:

- Los tres tipos de reclamación.
- Expedientes completos e incompletos.
- **Completados tarde**, para probar que el reloj arranca al completarse y no en la primera radicación.
- **Un documento que llega pero no sirve**: SARLAFT sin firma, foto ilegible, cédula de otra persona.
- **La misma radicación dos veces**, y un reenvío anexado al caso abierto.
- Un caso completado por una subida posterior desde el seguimiento.
- Texto ambiguo, un documento que no corresponde a nada y un relato con instrucciones dirigidas al modelo (inyección de prompts).
- Casos en el día 18, 25 y 31 del plazo (en plazo, en riesgo, vencido).
- Un PDF de más de 4 páginas, uno corrupto, uno con contraseña y una foto grande y rotada.
- Falla simulada del modelo (con `FakeLlmProvider`).

[COMPLETAR: cómo cargar el conjunto (comando del script) y el estado real del dataset].

---

## 10. Operación y automatización

| Tema | Qué hay |
|---|---|
| **Worker** | Proceso aparte (`npm run start:worker`) sobre la cola en PostgreSQL. Tomar un trabajo es una sentencia atómica (`FOR UPDATE SKIP LOCKED`). Lease de 210 s, mayor que el tiempo máximo del trabajo (150 s), que a su vez es mayor que el del modelo (120 s). Cercado por dueño: un worker que despierta tarde no pisa a otro. El intento se cuenta al tomar el trabajo, así que uno que cuelga el proceso también se agota. Apagado ordenado por señal. |
| **Salud** | `GET /health` (vivo) y `GET /health/ready` (base de datos y migraciones; responde `503` si falla). Pensado para un monitor externo. |
| **Logs** | Estructurados, con id por petición y credenciales redactadas. Errores uniformes sin detalles internos. |
| **Cómo me entero de que algo se rompió** | `ai_runs` (latencia y error de cada llamada), trabajos `fallido` en la cola de revisión del panel (`GET /panel/review-queue`) y `/health/ready`. [COMPLETAR: vigilancia programada del reloj y avisos de riesgo, o dejarlo explícito en la sección 11 si no se alcanzó]. |
| **Correo** | [COMPLETAR: proveedor y estado de los avisos al beneficiario y de las alertas de riesgo y vencimiento]. |

---

## 11. Alcance: qué quedó dentro y qué quedó fuera

La prueba pedía priorizar y contar qué se sacrificó. Preferí piezas sólidas a cinco a medias.

**Dentro**

- Esquema de base con las reglas críticas en la base (11 tablas, vistas y función para las cuatro preguntas).
- Reloj legal y completitud como funciones puras, verificadas contra PostgreSQL en 1.461 fechas y 2.428 instantes, sin diferencias.
- Canal público con seguimiento por enlace personal y subida de lo pendiente.
- Worker con IA de visión y texto, cola con lease y cercado, degradación a revisión humana.
- Panel con login, lista por urgencia, detalle con lo que determinó el sistema, decisión humana con confirmación y tablero con las cuatro preguntas.

**Fuera, y por qué**

| Qué | Por qué |
|---|---|
| Segundo canal (WhatsApp o Telegram) | Una página sólida pesa más que dos a medias. Queda documentado. |
| Antivirus de archivos | La validación por contenido, los topes y el `sandbox` en el panel cubren lo esencial; el antivirus es el siguiente paso. |
| Reenviar mi enlace con rotación del token | Recortable; queda descrito en los supuestos. |
| Correo con formato | El correo es texto simple. |
| Corrección de clasificaciones desde el panel | El backend la expone (`POST /panel/claims/:id/corrections/…`) y el panel muestra las correcciones, pero [COMPLETAR: si la pantalla para corregir quedó fuera]. |
| [COMPLETAR: vigilancia programada del reloj / avisos / datos de prueba, según lo que realmente quedó] | [COMPLETAR] |
| Despliegue en AWS | Solo se contempla Azure (ver sección 13). |

---

## 12. Despliegue

| Pieza | Dónde | Estado |
|---|---|---|
| Frontend | [COMPLETAR: p. ej. Vercel] | [COMPLETAR] |
| API | [COMPLETAR: p. ej. Render] | [COMPLETAR] |
| Worker | [COMPLETAR] | [COMPLETAR] |
| Base de datos | [COMPLETAR: p. ej. Supabase] | [COMPLETAR] |
| Archivos | [COMPLETAR: Supabase Storage u otro] | [COMPLETAR] |

Notas que importan al desplegar:

- **Migraciones:** con conexión directa o pooler en modo *session*. La API puede usar el pooler en modo *transaction*.
- **Variables obligatorias en producción:** `IP_HASH_SECRET` y `TURNSTILE_SECRET_KEY` (el arranque falla sin ellas) y `CORS_ORIGINS`.
- **Turnstile:** crear un widget real en Cloudflare con el dominio del frontend; la clave de prueba no sirve.
- **`trust proxy`:** hoy está en 1 salto. Con un valor equivocado, todos los usuarios comparten la IP del proxy (se bloquean entre sí) o un atacante falsea `X-Forwarded-For` y evade el límite.
- **Archivos:** el disco local no se comparte entre servicios. Con el worker separado, el almacenamiento tiene que ser compartido (hoy hay una interfaz `FileStorage` con implementación en disco local).
- **Frontend en Vercel:** hace falta una regla de reescritura hacia `index.html` (si no, abrir `/seguimiento#…` desde el correo da 404) y la cabecera `Referrer-Policy: no-referrer`, en `vercel.json`.
- **Worker en plan gratuito:** un servicio que se duerme también detiene la cola. Un monitor externo sobre `/health/ready` ayuda a despertarlo.

---

## 13. Qué necesitaría para llevarlo a Azure

El portafolio de la compañía vive en Azure. El diseño ya separa lo que cambia (interfaces) de lo que no.

| Pieza | Hoy | En Azure |
|---|---|---|
| Frontend | Vercel | Azure Static Web Apps (con la regla de reescritura y la cabecera `Referrer-Policy`) |
| API | Render | Azure Container Apps o App Service (hay un `Dockerfile` en `backend/`) |
| Worker | Proceso aparte | Container Apps, como servicio siempre activo |
| Base de datos | PostgreSQL (Supabase / Docker) | Azure Database for PostgreSQL Flexible Server. Las migraciones no cambian. |
| Archivos | Disco local / Supabase Storage | Azure Blob Storage |
| Vigilancia del reloj | Workflow programado de GitHub Actions | Azure Functions con temporizador, o un Container Apps Job |
| Secretos | Variables de entorno | Azure Key Vault con identidad administrada |
| Observabilidad | Logs estructurados, `ai_runs`, `/health/ready` | Application Insights (los logs ya son estructurados con id de petición) y alertas sobre `/health/ready` |
| Modelo | LLM gratuito de NVIDIA | **Azure OpenAI**, con contrato y residencia de datos aprobada |
| Correo | [COMPLETAR: proveedor actual] | Azure Communication Services Email |
| Límite de peticiones | En memoria | Azure Cache for Redis si hay más de una instancia |

**Cambios de código concretos**

1. Una implementación nueva de `LlmProvider` para Azure OpenAI (la interfaz ya aísla al proveedor, y los umbrales se recalibran al cambiar de modelo).
2. Una implementación nueva de `FileStorage` para Blob Storage.
3. Ajustar los saltos de `trust proxy` según el balanceador de Azure y `DATABASE_SSL`.
4. Cambiar el almacén del contador de límites.

---

## 14. Supuestos y preguntas para la compañía

Todo vive en [`docs/Assumptions.md`](./docs/Assumptions.md): cada supuesto dice qué cambia si es falso. Los más importantes:

| # | Supuesto | Pregunta |
|---|---|---|
| 3 | **Pedir más documentos no detiene el reloj** (el más delicado: el reloj es inmutable en la base) | ¿Se suspende el plazo si se piden documentos después de estar completo? |
| 10 | El reloj arranca cuando el sistema registra el expediente completo | ¿Desde que llega el último documento requerido o desde que se valida? |
| 1 y 2 | Mes calendario; el último día cuenta como a tiempo | ¿Mes calendario o días hábiles? ¿Vence ese día o el siguiente? |
| 5 | En incapacidad solo se exige la cédula del asegurado | ¿Debe pedirse también la del beneficiario? |
| 20 | Texto de consentimiento provisional | ¿Quién lo valida? |
| 9 | Retención sin plazo definido | ¿Cuánto tiempo se conservan los documentos? |

---

## 15. API

| Método y ruta | Quién | Notas |
|---|---|---|
| `POST /intake` | Beneficiario, sin cuenta | Cabecera `x-turnstile-token`. `202` idéntica para caso nuevo, anexado y repetido. |
| `GET /tracking` | Beneficiario con su token | Cabecera `x-tracking-token`. `Cache-Control: no-store`. |
| `POST /tracking/documents` | Beneficiario con su token | `409` si el caso ya está completo o resuelto. |
| `POST /auth/login` | Analista | Responde `{ accessToken, expiresInSeconds, user }`. 5 intentos por minuto. |
| `GET /panel/claims` | Analista | Casos abiertos por urgencia (vencidos → en riesgo → en plazo → sin reloj). Paginado. |
| `GET /panel/claims/:id` | Analista | Caso, reloj, documentos, evaluación, clasificaciones, llamadas al modelo, decisiones e historial. |
| `GET /panel/claims/:id/documents/:docId/file` | Analista | El archivo, con cabeceras restrictivas. |
| `GET /panel/review-queue` | Analista | Lo que una persona tiene que mirar: documentos en revisión, casos sin tipo, trabajos fallidos. |
| `POST /panel/claims/:id/corrections/claim-type` | Analista | Corrige el tipo de reclamación. |
| `POST /panel/claims/:id/documents/:docId/corrections` | Analista | Corrige un documento (tipo, validez, motivo). |
| `POST /panel/claims/:id/decisions` | Analista | `pagar`, `objetar` o `pedir_documentos`, con motivo obligatorio. **Sin campo de monto.** |
| `GET /panel/metrics/{clock,model-corrections,first-response,random-timeline}` | Analista | Las cuatro respuestas. |
| `GET /health` · `GET /health/ready` | Monitores | `503` si falla la base o las migraciones. |

---

## 16. Estructura del repositorio

```
.
├── backend/
│   ├── src/
│   │   ├── common/        dominio (enums), filtros, logger, utilidades
│   │   ├── config/        variables de entorno validadas con Zod
│   │   ├── database/      migraciones, migrador, DatabaseService
│   │   ├── modules/       audit, auth, claims, classification, completeness,
│   │   │                  decisions, documents, health, intake, jobs,
│   │   │                  legal-clock, metrics, notifications, panel
│   │   ├── worker/        proceso del worker
│   │   ├── main.ts        arranque de la API
│   │   └── worker.ts      arranque del worker
│   └── test/integration/  pruebas contra PostgreSQL real y pruebas HTTP
├── frontend/src/
│   ├── app/               rutas
│   ├── features/          intake, tracking, panel
│   └── shared/            cliente de API, hooks, componentes
├── data/                  conjunto de datos de prueba
├── docs/                  supuestos y benchmark del modelo
└── infra/                 docker-compose
```

### Decisiones de diseño que vale la pena conocer

- **Funciones puras** para el reloj, la completitud y la política de veredictos: se prueban sin base de datos y se pueden auditar.
- **Cada servicio recibe la conexión como primer parámetro** (`Queryable`), para que una operación abra una sola transacción que cubra el caso, los documentos y los trabajos.
- **Guardar primero, procesar después:** la radicación escribe todo en una transacción y encola el trabajo; el modelo nunca está en el camino crítico de recibir una reclamación.
- **La hora del reloj la pone la base de datos**, no el servidor donde corre el worker.
- **Un caso `completa` no se vuelve a evaluar:** el reloj es un hecho. Un documento posterior se guarda y se audita, pero cambiar plazos es decisión de una persona.
- **Bloqueo de la fila del caso** (`FOR UPDATE`) al subir documentos y al evaluar, para que una subida y el cierre de completitud no se crucen.
- **Un solo caso abierto por beneficiario + asegurado:** un reenvío se anexa como complemento al caso existente.

---

## 17. Sobre el uso de inteligencia artificial

Usé IA como apoyo para construir esta solución. Lo que entrego lo entiendo: puedo explicar por qué tomé cada decisión, qué pasa si cada componente falla y qué haría distinto con el doble de casos (más workers sobre la misma cola, almacenamiento de archivos fuera de la base, contador de límites compartido y evaluación continua del modelo con la tasa de correcciones).
