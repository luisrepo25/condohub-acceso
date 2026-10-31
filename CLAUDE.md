# CLAUDE.md — condohub-acceso

Microservicio **Acceso y portería** de CondoHub: contexto delimitado **Acceso** (visitas, pases QR, registros de ingreso y salida, vehículos, alertas de cámara) y receptor de la **sincronización offline** de la app del guardia. Responsable: **Erick**.

Este repo es independiente. Si está dentro del espacio de trabajo `condohub`, las reglas completas están en `../../docs/negocio/reglas-de-negocio.md` y los contratos en `../../contracts/openapi/acceso.yaml` y `../../contracts/events/`.

## Stack

Next.js 14 (solo **route handlers** en `app/api`, sin páginas) · TypeScript estricto · AWS SDK v3 DynamoDB (DynamoDB Local en dev) · amqplib · jose (JWT de Keycloak) · zod · Vitest · ESLint.

## Arquitectura: Clean

```
src/
├── domain/                # TS puro: sin Next, AWS SDK ni zod
│   ├── model/             # Visita, Pase, RegistroAcceso (agregados)
│   ├── value-objects/     # Placa, CodigoQR, IdempotencyKey, Confianza, VentanaValidez
│   ├── events/            # PaseEmitido, PaseRevocado, AccesoRegistrado, ResidenteIdentificado, DesconocidoDetectado
│   └── ports/             # VisitaRepository, RegistroAccesoRepository, ReconocimientoPort, EventPublisher, Clock
├── application/           # casos de uso: RegistrarVisita, ValidarPase, RegistrarAcceso, SincronizarLote, EmitirPasesReserva
├── infrastructure/
│   ├── dynamodb/          # repositorios, escrituras condicionales
│   ├── messaging/         # outbox + consumidor de la saga (pasos 3 y compensación)
│   └── ia-acl/            # CAPA ANTICORRUPCIÓN: traduce respuestas del Servicio IA a conceptos de Acceso
└── app/api/               # route handlers: validan JWT y forma (zod), llaman application
```

`domain` y `application` no importan nada de `next`, `@aws-sdk/*` ni `zod` (regla ESLint `no-restricted-imports`).

## Reglas de negocio que implementa

| Código | Resumen |
|---|---|
| A1 | Visita registrada → pase QR con ventana (por defecto el día, 07:00–23:59) y un solo uso |
| A2 | Pase vencido, usado o revocado → rechazo con motivo; sin pase, registro manual con unidad que autoriza |
| A3 | Registros de acceso append-only; un error se corrige con un registro nuevo que referencia al anterior |
| A4 | Placa de residente con confianza ≥ 0.85 → ingreso; menor o sin coincidencia → decide el guardia |
| A5 | El reconocimiento facial solo asiste al guardia; nunca abre ni bloquea por sí solo |
| O1–O4 | `Idempotency-Key` UUID v4; escritura condicional; repetido = misma respuesta; sincronizado solo con 2xx |
| O6 | Offline se permite registrar ingresos/salidas y validar pases ya descargados |
| S3 de la saga | Emitir y revocar pases de invitados de una reserva, idempotente por `eventId` |

## DynamoDB (diseño de tabla única)

| Entidad | PK | SK |
|---|---|---|
| Visita | `UNIDAD#<id>` | `VISITA#<fecha>#<visitaId>` |
| Pase | `PASE#<codigo>` | `META` |
| Registro de acceso | `DIA#<yyyy-mm-dd>` | `ACCESO#<timestamp>#<id>` |
| Clave de idempotencia | `IDEM#<uuid>` | `META` (guarda la respuesta original, TTL 7 días) |

- Toda escritura desde la PWA usa `TransactWriteItems` con `attribute_not_exists(PK)` sobre `IDEM#<uuid>` + el registro. Si falla por condición, se lee y devuelve la respuesta guardada.
- Uso de pase: actualización condicional `usos = 0` para que dos guardias no lo usen dos veces.

## Endpoints principales

`POST /api/visitas` · `POST /api/pases/validar` · `POST /api/accesos` · `POST /api/sync` (lote de operaciones offline; responde una entrada por operación) · `GET /api/pases/guardia?desde=` (pases vigentes para cachear en la PWA) · `GET /api/alertas`.

## Comandos

```bash
npm install
npm run dev            # puerto 3001
npm run test           # vitest
npm run lint
npm run db:crear       # crea la tabla en DynamoDB Local (db/crear-tabla.mjs)
npm run db:demo        # datos de demostración (db/datos-demo.mjs)
```

## Convenciones locales

- Tests de dominio: `it('A3: un registro de acceso no se puede modificar')`. Test de idempotencia obligatorio para `/api/sync`: enviar el mismo lote dos veces y comprobar que hay un solo registro y la misma respuesta.
- La hora del dispositivo se guarda (`horaDispositivo`) junto a la hora del servidor; nunca se reemplaza una por otra.

## Estado y seguridad (actualizado 31/10/2026)

Implementados y protegidos por rol: `POST /api/visitas` (A1, F1 con `miPerfil` de Gestión), `POST /api/pases/validar` y `GET /api/pases/guardia` (A2, O6), `POST /api/accesos` y `POST /api/sync` (A3, O1–O4, idempotencia con DynamoDB), `GET /api/placas` (A4) y `GET /api/salud`, más el consumidor de la saga de reservas (paso 3: emitir y revocar pases). **Solo `GET /api/alertas` sigue en `501`**: el tablero del guardia lee las alertas de visitantes recurrentes del Servicio IA (`GET /ia/rostros/visitantes-recurrentes`) mientras tanto. 121 pruebas pasan y 18 de integración con DynamoDB se omiten si no hay DynamoDB Local.

- Roles (propuesta derivada de A1–A3 y escrita en `contracts/openapi/acceso.yaml`, decidido por Luis el 31/10/2026; Aldana y Erick siguen esta decisión): `GET /api/salud` cualquiera · `POST /api/visitas`: RESIDENTE, ADMIN · `POST /api/pases/validar`, `GET /api/pases/guardia`, `POST /api/accesos`, `POST /api/sync`, `GET /api/alertas`: GUARDIA, ADMIN.
- Los route handlers se escriben con `proteger([...roles], manejador)` (`src/infrastructure/http/proteger.ts`); JWT con `jose` en `src/infrastructure/keycloak/jose-verificador.ts`; errores problem+json en `problemas.ts`.
- ESLint prohíbe a `domain` y `application` importar `next`, `@aws-sdk`, `zod`, `jose` o infraestructura. `npm test` (35 tests, incluido el de contrato con `acceso.yaml`), `npm run lint`, `npm run typecheck`, `npm run build`.
- Variables: `KEYCLOAK_ISSUER`, `KEYCLOAK_JWKS`. Por el gateway: `http://localhost:8080/acceso/api/salud` con Bearer.
- Contenedor y CI (16/10/2026): `Dockerfile` en la raíz del repo; `infra/docker-compose.apps.yml` lo levanta junto al resto; `.github/workflows/ci.yml` corre las pruebas y publica la imagen en GHCR desde `main`.

## Código funcional protegido (obligatorio)

Código en `main` con tests en verde **no se reescribe, refactoriza, renombra ni reformatea** si la tarea no lo pide explícitamente. Lo nuevo se agrega extendiendo (clases, métodos o archivos nuevos). Si es inevitable tocar código funcional, **detente antes de editar**, explica qué archivo/líneas y por qué, y espera confirmación; luego haz el mínimo diff. Nunca edites tests existentes para que pase código nuevo. Corre los tests antes y después: todo lo que pasaba debe seguir pasando. En el resumen, lista cada archivo existente que modificaste.
