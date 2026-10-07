# Supuestos y preguntas para la compañía

> Prueba técnica AIX (Vacante 631). Última actualización: martes 6 de octubre de 2026, al cierre de la rama 8 (modelo, worker y reloj).

El enunciado está incompleto a propósito. Este documento registra, para cada hueco: qué se asumió, **qué cambia en la solución si la suposición resulta falsa** y qué se le preguntaría a la compañía. Los supuestos 1 a 9 vienen de la planificación inicial; del 10 al 26 surgieron al construir el canal de radicación y del 27 en adelante, al construir el modelo, el worker y el reloj.

## Cómo leerlo

| Estado | Significado |
|---|---|
| **Por confirmar** | Depende de una respuesta de la compañía. La solución funciona con el supuesto y está preparada para cambiarlo |
| **Decidido** | Decisión propia de diseño; no depende de una respuesta, pero se deja visible para que se pueda cuestionar |
| **Riesgo aceptado** | Se conoce la debilidad, se evaluó y se dejó así a propósito. Se explica la mitigación |

Cada punto tiene un espacio **Respuesta** para anotar lo que conteste la compañía. Si no llega respuesta antes de la sustentación, rige el supuesto tal como está escrito.

## Las preguntas que más cambian la solución

Ordenadas por impacto. Hay un texto listo para enviar al final del documento.

1. **#3 · ¿Pedir más documentos suspende el plazo?** Es la más delicada: la base de datos hoy hace inmutable el reloj una vez arranca.
2. **#10 · ¿Desde cuándo corre el reloj?** ¿Desde que el sistema o un analista registra el expediente como completo, o desde que llegó el último documento requerido?
3. **#1 y #2 · ¿Mes calendario o días hábiles? ¿El último día cuenta?** Cambian la fecha de vencimiento de todos los casos.
4. **#5 · En incapacidad total y permanente, ¿se exige la cédula del beneficiario?**
5. **#20 · ¿Quién valida el texto de consentimiento y el tratamiento de datos personales?**
6. **#9 · ¿Cuánto tiempo y bajo qué política se conservan los documentos?**

---

## A. El plazo legal

### 1. «Un mes» es mes calendario
- **Supuesto:** el plazo del artículo 1080 es un mes calendario, en hora de Colombia (31 de octubre + 1 mes = 30 de noviembre). No se ajusta por días hábiles ni por festivos.
- **Si es falso:** se cambia una función pura (`legal-clock.ts`) y su prueba. Los casos que ya completaron conservan su fecha, porque el reloj es inmutable por diseño; habría que decidir si se recalculan con una migración explícita y registrada.
- **Pregunta:** ¿el plazo es de mes calendario o se ajusta por días hábiles y festivos?
- **Estado:** Por confirmar · **Respuesta:** —

### 2. La fecha límite es el último día del plazo, inclusive
- **Supuesto:** si el plazo vence el 20, el caso está a tiempo durante todo el día 20 y se considera vencido desde el 21.
- **Si es falso:** cambia una comparación en una función pura y en la función de la base de datos que calcula el día del plazo. Ambas se verificaron entre sí en 1.461 fechas.
- **Pregunta:** ¿el vencimiento es ese mismo día o el siguiente?
- **Estado:** Por confirmar · **Respuesta:** —

### 3. «Pedir más documentos» no detiene el reloj
- **Supuesto:** una vez el expediente quedó completo y el reloj corre, la decisión «pedir más documentos» es una acción del analista que **no suspende** el plazo.
- **Si es falso:** es el cambio más grande. Hoy un trigger impide modificar `completed_at` y `deadline_date` después de que arrancan. Suspender el plazo exige una tabla de pausas, cambiar `fn_claim_clock()` y las vistas que dependen de ella, y una migración. Está preparado para hacerse, pero no es un ajuste menor.
- **Pregunta:** si el analista pide más documentos con el expediente ya completo, ¿se suspende el plazo? ¿Desde cuándo y hasta cuándo?
- **Estado:** Por confirmar · **Respuesta:** —

### 4. «En riesgo» significa siete días o menos
- **Supuesto:** un caso entra en riesgo cuando le quedan 7 días o menos del plazo.
- **Si es falso:** es una constante. Si la compañía usa varios umbrales (por ejemplo 10 y 3 días), se agrega un segundo aviso.
- **Pregunta:** ¿qué umbral usa la compañía para considerar un caso en riesgo?
- **Estado:** Por confirmar · **Respuesta:** —

### 10. El reloj arranca cuando el sistema registra el expediente como completo
- **Supuesto:** `completed_at` es el instante en que el sistema deja constancia de que el expediente está completo (cuando el último documento requerido se analiza y es válido), no el instante en que el beneficiario subió el último archivo. Normalmente son minutos; si un documento necesita revisión humana, puede ser más.
- **Si es falso:** se puede fijar `completed_at` con la hora de llegada del último documento requerido, de forma retroactiva. El dato existe (`documents.uploaded_at`), pero el trigger del reloj solo permite fijarlo una vez y hay que escribirlo bien desde el principio.
- **Por qué importa:** el artículo 1080 cuenta desde que el beneficiario *acredita su derecho*. Si el análisis tarda, el plazo de la compañía empezaría más tarde que el del beneficiario, y eso podría leerse a favor del beneficiario.
- **Pregunta:** ¿el plazo cuenta desde que llega el último documento requerido, o desde que la compañía lo valida?
- **Estado:** Por confirmar · **Respuesta:** —

---

## B. El expediente y los documentos

### 5. En incapacidad total y permanente solo se exige la cédula del asegurado
- **Supuesto:** el asegurado y el beneficiario son la misma persona, así que no se exige un documento de identidad del beneficiario. El enunciado solo lista el del asegurado.
- **Si es falso:** se agrega un requisito en `completeness.rules.ts` y se sube `RULES_VERSION`. Cada evaluación guardada registra con qué versión de las reglas se hizo, así que lo ya evaluado no se reinterpreta en silencio.
- **Pregunta:** ¿debe pedirse también el documento de identidad del beneficiario en incapacidad?
- **Estado:** Por confirmar · **Respuesta:** —

### 6. Un reenvío del formulario no reemplaza el relato original
- **Supuesto:** si el beneficiario vuelve a radicar con un caso abierto, el texto nuevo no sustituye al relato original; los documentos nuevos sí se anexan. Cada reenvío queda registrado como un envío de tipo «complemento».
- **Si es falso:** habría que guardar versiones del relato. La tabla de envíos ya registra cada llegada; faltaría guardar el texto de cada una.
- **Pregunta:** ¿cómo se manejan las correcciones al relato del beneficiario?
- **Estado:** Por confirmar · **Respuesta:** —

### 7. Un solo caso abierto por beneficiario y asegurado
- **Supuesto:** el mismo beneficiario no puede tener dos reclamaciones abiertas por el mismo asegurado. Lo hace cumplir un índice único de la base de datos, no solo el código. Varios beneficiarios sobre un mismo asegurado son casos distintos.
- **Si es falso:** se cambia el índice parcial por otra regla. Con varios beneficiarios habría que decidir si cada uno es una reclamación o forman una sola.
- **Pregunta:** ¿varios beneficiarios sobre un mismo asegurado son una reclamación o varias?
- **Estado:** Por confirmar · **Respuesta:** —

### 8. Formatos de archivo y límites
- **Supuesto:** se aceptan PDF, JPEG, PNG y WebP, hasta 10 MB por archivo y 10 archivos por envío. El tipo se valida por los primeros bytes del archivo, no por la extensión. HEIC (el formato de las fotos de iPhone) queda fuera de alcance.
- **Si es falso:** agregar un formato es una entrada en `file-signature.ts` más, si es HEIC, un paso de conversión antes de enviar la imagen al modelo.
- **Pregunta:** ¿hay formatos obligatorios que deban aceptarse (por ejemplo HEIC)? ¿Hay un tamaño máximo por archivo?
- **Estado:** Por confirmar · **Respuesta:** —

### 11. Un documento que no corresponde a ningún requisito se conserva, pero no cuenta
- **Supuesto:** si llega un documento de un tipo que el expediente no exige (o que el modelo no logra identificar), se guarda y queda visible para el analista, pero no cuenta para la completitud ni se le informa al beneficiario como pendiente.
- **Si es falso:** se puede avisar al beneficiario de que «recibimos X, que no necesitamos». Hoy la función de completitud ya devuelve esos documentos aparte.
- **Estado:** Decidido · **Respuesta:** —

### 12. Tipos de documento de identidad y su longitud
- **Supuesto:** se aceptan CC, CE, PA, PEP y PPT. El número se normaliza (sin puntos, espacios ni guiones, en mayúsculas) y debe tener entre 5 y 15 caracteres. La normalización importa: sin ella, «1.234.567» y «1234567» serían dos beneficiarios distintos y podrían abrir dos expedientes.
- **Si es falso:** es una lista en `intake.schema.ts`.
- **Pregunta:** ¿qué tipos de documento de identidad acepta la compañía?
- **Estado:** Por confirmar · **Respuesta:** —

### 13. El mismo archivo en otro caso no es un duplicado
- **Supuesto:** el hash del archivo es único **por caso**, no global. Si dos beneficiarios distintos suben un archivo idéntico, son dos documentos de dos casos. Dentro de un mismo caso, el mismo archivo dos veces no crea otro documento ni reinicia nada.
- **Si es falso:** un índice global rompería casos legítimos (por ejemplo, una certificación bancaria compartida) y filtraría información entre beneficiarios.
- **Estado:** Decidido · **Respuesta:** —

---

## C. Canal, identidad y seguimiento

### 14. Un solo canal: página web, pensada primero para el celular
- **Supuesto:** el canal de radicación es una página pública, sin crear usuario. WhatsApp y Telegram quedan fuera de alcance: prefiero tres piezas sólidas que cinco a medias. El motor no depende del canal (cada envío registra el suyo), así que agregar uno es una pieza nueva en la entrada, no un rediseño.
- **Estado:** Decidido · **Respuesta:** —

### 15. El token de seguimiento es la credencial; el enlace lo entrega el correo
- **Supuesto:** el beneficiario no crea cuenta. Al radicar se genera un token aleatorio de 256 bits; en la base solo se guarda su hash. El token viaja en una cabecera (`x-tracking-token`), **nunca en la URL**, porque las URL quedan en los logs. El enlace que recibe la persona lleva el token en el fragmento (`/seguimiento#<token>`), que el navegador no envía a ningún servidor.
- **Entrega:** por correo al beneficiario (rama de notificaciones). Hasta entonces, un componente intercambiable lo escribe en el log en desarrollo y no entrega nada en producción.
- **Si es falso:** cambiar de canal de entrega es cambiar una implementación; el resto no se toca.
- **Estado:** Decidido · **Respuesta:** —

### 16. La radicación responde lo mismo siempre, y por eso quien radica de nuevo no recibe enlace
- **Supuesto:** la respuesta de `POST /intake` es idéntica para un caso nuevo, un reenvío anexado y un duplicado. Si fuera distinta, cualquiera que conozca dos números de documento podría averiguar si existe una reclamación. El costo: el token solo existe en el instante de crear el caso, y quien radica otra vez no recibe un enlace.
- **Pendiente:** un flujo de «reenviar mi enlace» que **rote** el token (el anterior deja de servir) y lo envíe al correo registrado. Hasta que exista, quien pierda el enlace debe escribir a la compañía.
- **Límite conocido:** el caso nuevo tarda un poco más que el anexo, así que la diferencia de tiempo podría delatarlo. Para esta prueba se acepta.
- **Estado:** Decidido · **Respuesta:** —

### 17. Anexar documentos a un caso abierto sin token
- **Riesgo:** quien conozca el documento del beneficiario y el del asegurado puede radicar y subir archivos al caso abierto de otra persona.
- **Por qué se acepta:** el daño es limitado. Solo suma documentos que el modelo revisa y el analista ve; la completitud la decide el código, el beneficiario real los ve en su seguimiento, y no se puede leer nada del caso ni cambiarlo. Los límites por IP y el captcha frenan el abuso automatizado.
- **Mitigación posible:** exigir el token para anexar y, si no lo trae, dejar el envío en un estado de «pendiente de verificar».
- **Estado:** Riesgo aceptado · **Respuesta:** —

### 18. Con el expediente completo o el caso resuelto, el beneficiario ya no sube documentos
- **Supuesto:** desde el seguimiento solo se puede subir mientras el caso está recibido o incompleto. Con el reloj corriendo, cambiar los documentos es una decisión de un analista, no del beneficiario; la subida responde que se comunique con la compañía.
- **Si es falso:** se quita una comprobación en `complement.service.ts`. Está ligado al supuesto #3.
- **Pregunta:** si el expediente está completo y el beneficiario quiere corregir un documento, ¿cuál es el camino?
- **Estado:** Por confirmar · **Respuesta:** —

### 19. La página de seguimiento no comunica pago ni objeción, ni muestra el plazo
- **Supuesto:** un caso resuelto muestra un texto neutro («la compañía te comunicará la decisión por sus medios formales»), sin decir si se pagó o se objetó. La fecha límite tampoco se muestra: es información interna del analista. La objeción debe comunicarse de manera formal, no desde una página de estado.
- **Si es falso:** son textos en `tracking.messages.ts` y una rama en la vista.
- **Estado:** Decidido · **Respuesta:** —

---

## D. Datos personales y seguridad

### 20. El texto de consentimiento es provisional
- **Supuesto:** el formulario pide aceptar el tratamiento de datos, con versión `2026-10-v1` guardada junto a cada caso. El texto real lo redactaría el área jurídica. Se asume que aplica la normativa colombiana de protección de datos personales (Ley 1581 de 2012); debe validarlo la compañía.
- **Si es falso:** se cambia el texto y se sube la versión; cada caso conserva la versión que aceptó.
- **Pregunta:** ¿quién valida el texto de consentimiento y qué finalidades debe declarar?
- **Estado:** Por confirmar · **Respuesta:** —

### 9. Retención de documentos sin plazo definido
- **Supuesto:** los documentos y los expedientes no se borran (la base lo impide con triggers) y no hay política de retención automática.
- **Si es falso:** se agrega una tarea programada de depuración. Tendría que convivir con las tablas de solo inserción, que hoy no permiten borrar.
- **Pregunta:** ¿cuánto tiempo y bajo qué política se conservan los documentos y la bitácora?
- **Estado:** Por confirmar · **Respuesta:** —

### 21. El hash de la IP es un dato personal seudonimizado
- **Supuesto:** de cada envío se guarda un hash de la IP, calculado con HMAC y un secreto del entorno, para poder ver que varios envíos sospechosos vienen del mismo origen sin guardar la IP. Un hash simple se revierte probando todas las IPv4; con el secreto no. Si se cambia el secreto, se pierde la correlación con los envíos anteriores. Sigue siendo un dato personal y se trata con la misma retención que el resto (#9).
- **Estado:** Decidido · **Respuesta:** —

### 22. Los límites de peticiones son generosos a propósito
- **Supuesto:** muchas personas comparten una misma IP pública (redes móviles, oficinas). Bloquear de más a una familia que necesita radicar es peor que el abuso que se quiere evitar. Los límites por IP son: radicar 5 por minuto y 30 por hora; ver el seguimiento 30 por minuto y 300 por hora; subir documentos 5 por minuto y 30 por hora. El límite no es la defensa principal: la idempotencia y el captcha hacen el resto.
- **Límite conocido:** el contador vive en la memoria de la API. Se reinicia al reiniciarla y no se comparte entre instancias; con varias instancias hay que pasarlo a un almacenamiento compartido (Redis o una tabla).
- **Estado:** Decidido · **Respuesta:** —

### 23. Si el captcha no puede consultarse, se deja radicar
- **Supuesto:** el captcha (Cloudflare Turnstile) se verifica antes de leer los archivos. Si Cloudflare no responde o la clave está mal configurada, se deja pasar y se registra un error. Si el token es falso, repetido o vencido, se rechaza.
- **Límite:** esta postura ayuda menos de lo que parece. Si Cloudflare está caído, el navegador tampoco obtiene un token y la petición se rechaza igual por no traerlo; dejar pasar las peticiones sin token vaciaría el captcha. Solo cubre el caso en que el navegador sí tenía un token y nuestro servidor no pudo validarlo.
- **Si es falso:** bloquear en lugar de dejar pasar es una línea en `turnstile.guard.ts`.
- **Estado:** Decidido · **Respuesta:** —

### 24. Los archivos no pasan por un antivirus
- **Supuesto:** se valida el tipo por contenido, el tamaño y la cantidad, y los archivos se guardan con una ruta derivada del hash, nunca del nombre que envía la persona. No hay análisis antivirus.
- **Si es falso:** se agrega un paso de análisis entre la recepción y el almacenamiento, o antes de que el analista abra el archivo.
- **Estado:** Decidido (siguiente paso documentado) · **Respuesta:** —

### 25. Todos los datos de prueba son sintéticos
- **Supuesto:** los documentos y las personas del conjunto de pruebas se generan para la prueba; nunca se usan datos reales. Los correos usan dominios de ejemplo.
- **Estado:** Decidido · **Respuesta:** —

---

## E. El modelo

### 26. El modelo no decide la completitud ni muestra un tipo dudoso al beneficiario
- **Decisión:** la completitud la decide una función pura del código, nunca el modelo. El tipo de reclamación (`claims.claim_type`) determina la lista de requisitos que ve el beneficiario, así que solo se escribe cuando el modelo tiene confianza alta o cuando una persona lo confirma. Si el modelo duda, el tipo queda vacío, el beneficiario ve «estamos revisando» y el caso aparece para revisión humana. Mostrar una lista equivocada a alguien que acaba de perder a un familiar es peor que no mostrar nada todavía.
- **Estado:** Decidido (implementado en la rama 8, con el invariante de que ninguna confianza bajo su umbral produce un veredicto firme) · **Respuesta:** —

---

## F. IA, documentos y reloj

### 27. Los documentos y los nombres se envían a un proveedor de IA de terceros
- **Supuesto:** para la prueba se usa el endpoint gratuito de NVIDIA. Se envían las imágenes del documento y el nombre y número de documento del asegurado y del beneficiario, para que el modelo juzgue, por ejemplo, si una cédula corresponde al asegurado. Todos los datos de la prueba son sintéticos (#25). El razonamiento interno del modelo no se lee ni se guarda.
- **Si es falso:** en producción hace falta un proveedor con contrato, residencia de datos y política de retención aprobados (en Azure, Azure OpenAI). Cambiarlo es una implementación de `LlmProvider`; el resto no se toca.
- **Pregunta:** ¿qué proveedores y regiones de datos están aprobados para procesar documentos de beneficiarios?
- **Estado:** Por confirmar · **Respuesta:** —

### 28. Al modelo se le envían como máximo 4 páginas por documento
- **Supuesto:** todo documento llega al modelo como imágenes: cada PDF se dibuja página por página (máximo 4, lado mayor de 1600 px) y cada foto se reduce al mismo tamaño. Si el PDF tiene más páginas, el documento va a revisión humana y **nunca** queda válido ni inválido por omisión: la firma podría estar en una página que no se vio. Una imagen de prueba costó ≈ 16.800 tokens de entrada, y por eso el tamaño y el número de páginas tienen tope.
- **Si es falso:** es una constante; más páginas significan más tokens y más latencia.
- **Límite conocido:** el PDF se dibuja dentro del proceso del worker. El tiempo máximo del trabajo abandona la espera pero no detiene un dibujo colgado; el siguiente paso sería un hilo o un proceso aparte.
- **Pregunta:** ¿cuántas páginas tiene normalmente un expediente?
- **Estado:** Decidido · **Respuesta:** —

### 29. Los umbrales de confianza son valores iniciales
- **Supuesto:** documento 0,8 · legibilidad 0,7 · firma 0,8 · coincidencia con el asegurado 0,8 · tipo de reclamación 0,85. Con una confianza bajo el umbral, el veredicto es «revisión humana», nunca «inválido». La confianza que reporta el modelo no está calibrada: en las pruebas se agrupa en 0,85 a 0,95.
- **Si es falso:** son constantes en `classification.policy.ts` con su `POLICY_VERSION`. Se recalibran con la tasa de correcciones de las personas, y de nuevo cada vez que cambie el modelo o el prompt.
- **Estado:** Decidido (se calibra con datos) · **Respuesta:** —

### 30. Solo se exige firma al SARLAFT y solo se contrasta la cédula del asegurado
- **Supuesto:** el enunciado exige «SARLAFT firmado», así que solo ese documento se rechaza por falta de firma. La cédula del beneficiario solo se valida por legibilidad: el motivo `no_corresponde_beneficiario` existe en el dominio, pero hoy no se produce. Un formato de reclamación o una certificación bancaria sin firma no se rechazan.
- **Si es falso:** agregar otro documento al conjunto que exige firma es una línea; contrastar la cédula del beneficiario es agregar `matchesBeneficiary` al esquema del modelo y una comprobación en la política.
- **Pregunta:** ¿qué documentos deben ir firmados, además del SARLAFT? ¿Debe contrastarse la cédula del beneficiario con quien radica?
- **Estado:** Por confirmar · **Respuesta:** —

### 31. Un documento de tipo incierto, «otro» o dañado va a una persona y no cuenta
- **Supuesto:** si el modelo no sabe de qué documento se trata, o es de un tipo que el expediente no exige, el documento se conserva, queda para revisión humana y no cuenta para ningún requisito (precisa el #11). Un archivo corrupto o con contraseña recibe el motivo `archivo_danado`, sin llamar al modelo ni reintentar. Mientras una persona lo revisa, la página de seguimiento no afirma que «falta» un documento: dice que se está revisando.
- **Si es falso:** se pueden agregar avisos específicos al beneficiario («no pudimos abrir tu archivo»). Hoy no hay un mensaje propio para `archivo_danado`; lo agrega la rama de notificaciones.
- **Estado:** Decidido · **Respuesta:** —

### 32. Con el expediente completo no se reevalúa, y el reloj usa la hora de la base de datos
- **Supuesto:** una vez el caso está `completa`, no se evalúa hacia atrás: un documento posterior se guarda y se audita, pero no cambia el estado ni el plazo. El instante `completed_at` lo toma la base de datos (`clock_timestamp()`) y no el servidor donde corre el worker; la fecha límite sale de la misma función pura que se verificó contra PostgreSQL.
- **Si es falso:** está ligado a los #3 y #18. Suspender o reabrir un plazo exige una tabla de pausas y una migración.
- **Estado:** Por confirmar (junto con el #3) · **Respuesta:** —

### 33. Si el modelo falla, el documento pasa a una persona; el tipo ambiguo se reclasifica una sola vez
- **Supuesto:** cada trabajo se intenta hasta 5 veces, con espera creciente (30 s, 60 s, 120 s…, y al menos 60 s tras un límite de peticiones). Tras el último intento, el documento pasa a `requiere_revision` y el caso queda visible: nada se queda «pendiente» para siempre. Un caso sin tipo se reclasifica **una sola vez** cuando todos sus documentos ya están analizados (un informe de policía puede resolver lo que el relato no); si sigue ambiguo, lo decide una persona.
- **Si es falso:** el número de intentos y la espera son configuración; reclasificar más veces es cambiar la llave de deduplicación.
- **Estado:** Decidido · **Respuesta:** —

---

## Fuera de alcance y límites conocidos

- Un solo canal de radicación (web); sin WhatsApp ni Telegram.
- Sin antivirus de archivos (#24) y sin soporte de HEIC (#8).
- El enlace de seguimiento solo se entrega al crear el caso; el flujo de reenvío con rotación del token está pendiente (#16).
- El contador de límites por IP vive en memoria (#22).
- Los archivos se guardan dentro de la transacción de radicación. Con almacenamiento local es rápido; con almacenamiento remoto, lo mejor sería guardarlos antes de abrir la transacción, y quedarían archivos huérfanos si se revierte (inofensivos: la ruta es el hash).
- La diferencia de tiempo entre un caso nuevo y uno anexado podría delatar si existe un caso (#16).
- Los correos al beneficiario son texto simple, sin formato.
- No hay retención automática de documentos (#9).
- La visión se probó con una sola imagen; falta compararla con documentos sintéticos (firma ausente, cédula de otra persona).
- La cédula del beneficiario solo se valida por legibilidad (#30).
- El PDF se dibuja en el mismo proceso del worker (#28).
- El proveedor de IA gratuito no ofrece garantías: su latencia varía con la carga y a veces corta la respuesta (#27).
- Un caso con el expediente completo no se reevalúa (#32).

---

## Texto listo para enviar a la compañía

Asunto: Dudas sobre el enunciado · Prueba técnica Vacante 631

> Hola. Mientras construyo la solución me surgieron algunas dudas sobre el enunciado. Trabajo con los supuestos que van entre paréntesis y los dejé documentados en el repositorio, con lo que cambiaría si alguno resulta distinto.
>
> 1. Si el analista pide más documentos con el expediente ya completo, ¿se suspende el plazo del artículo 1080? (Asumo que no.)
> 2. ¿El plazo corre desde que llega el último documento requerido o desde que la compañía lo valida? (Asumo que desde que el sistema registra el expediente completo.)
> 3. ¿«Un mes» es mes calendario o se ajusta por días hábiles y festivos, y el último día cuenta como a tiempo? (Asumo mes calendario, último día incluido.)
> 4. En incapacidad total y permanente, ¿se exige el documento de identidad del beneficiario? (Asumo que no, porque coincide con el asegurado.)
> 5. ¿Quién valida el texto de consentimiento para el tratamiento de datos? (Dejé uno provisional con versión.)
> 6. ¿Hay una política de retención para los documentos? (Asumo que no se borran.)
>
> Gracias.