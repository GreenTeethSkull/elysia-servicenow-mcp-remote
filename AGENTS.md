# AGENTS.md — Instrucciones para Agentes de IA

Este archivo proporciona contexto esencial del proyecto **elysia-servicenow-mcp-remote** para que cualquier agente de IA pueda trabajar efectivamente en él.

## Descripción del Proyecto

Servidor MCP (Model Context Protocol) remoto para ServiceNow, construido con ElysiaJS y Bun. Expone 4 herramientas para buscar incidentes, problemas, cambios y requisitos en una instancia de ServiceNow. Diseñado para ser consumido por agentes de IA (Claude, Cursor, etc.) vía Streamable HTTP.

## Stack Tecnológico

- **Runtime**: Bun (JavaScript/TypeScript runtime de alto rendimiento)
- **Framework Web**: ElysiaJS (ultrarrápido, type-safe)
- **Protocolo**: MCP (Model Context Protocol) via Streamable HTTP
- **Lenguaje**: TypeScript
- **Contenedorización**: Docker (multi-stage build)
- **Autenticación**: ServiceNow OAuth2 (Resource Owner Password Credentials grant)

## Arquitectura

### Flujo de Request

```
Cliente MCP (Claude/Cursor/Agente)
  ↓ POST /mcp (JSON-RPC)
ElysiaJS Server
  ↓ Crea McpServer + StreamableHTTPServerTransport por request
McpServer (instancia aislada)
  ↓ Ejecuta tool handler
ServiceNowClient (OAuth2 Bearer token)
  ↓ HTTP requests a endpoints custom de ServiceNow
ServiceNow Instance
```

### Concurrencia

Cada request POST `/mcp` crea una nueva instancia de `McpServer` y `StreamableHTTPServerTransport`. Esto permite manejar múltiples requests simultáneos sin conflictos de estado compartido.

### Autenticación OAuth2

El `ServiceNowClient` implementa gestión completa de tokens OAuth2:
- **Obtención de token**: POST a `/oauth_token.do` con grant_type=password
- **Cache en memoria**: El token se almacena y reutiliza hasta su expiración
- **Auto-refresh**: Se refresca automáticamente 60 segundos antes de expirar
- **Re-auth en 401**: Si un request retorna 401, se obtiene un nuevo token y se reintenta
- **Variables de entorno**: `SERVICENOW_CLIENT_ID`, `SERVICENOW_CLIENT_SECRET`, `SERVICENOW_USERNAME`, `SERVICENOW_PASSWORD`

### Rate Limiting

- **Límite**: 60 tool calls por ventana de 60 segundos (global, no por cliente)
- **Configuración**: `src/constants.ts` → `RATE_LIMIT_MAX_CALLS = 60`, `RATE_LIMIT_WINDOW_MS = 60_000`
- **Implementación**: Array en memoria `toolCallTimestamps` en `src/tools/index.ts`

### Retry con Backoff

El `ServiceNowClient` implementa reintentos automáticos ante HTTP 429:
- **Máximo de reintentos**: 3 (`MAX_RETRIES`)
- **Delay base**: 1 segundo (`RETRY_BASE_DELAY_MS`)
- **Estrategia**: Exponential backoff (1s → 2s → 4s)

## Estructura de Archivos

```
src/
├── index.ts                       # Entry point - inicializa servidor
├── server.ts                      # ElysiaJS app + endpoint /mcp + concurrencia
├── constants.ts                   # Constantes globales (OAuth, endpoints, rate limit, etc.)
├── services/
│   ├── servicenow-client.ts       # Cliente HTTP con OAuth2 (token management + retry)
│   ├── servicenow-env.ts          # Validación de variables de entorno OAuth
│   └── logger.ts                  # Sistema de logging estructurado (JSON + child loggers)
├── tools/
│   ├── index.ts                   # Registro de tools + rate limiting + error handling
│   ├── incident-search.ts         # Tool: incident_search
│   ├── problem-search.ts          # Tool: problem_search
│   ├── requirement-search.ts      # Tool: requirement_search
│   └── change-search.ts           # Tool: change_search
└── utils/
    ├── formatters.ts              # Formateo de respuestas
    └── query-builder.ts           # Constructor de queries sn_query
```

## Comandos

### Desarrollo

```bash
bun install          # Instalar dependencias
bun run dev          # Servidor con hot reload (--watch)
bun run start        # Servidor en modo producción
bun run build        # Compilar a binario único (./server)
bun run test         # Ejecutar tests
bun run typecheck    # Type check sin emitir archivos (bunx tsc --noEmit)
```

### Docker

```bash
docker build -t elysia-servicenow-mcp-remote .
docker run -p 3000:3000 --env-file .env elysia-servicenow-mcp-remote
```

### Multi-arquitectura (arm64 + amd64)

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t greenteethskull/elysia-servicenow-mcp-remote:latest \
  --push .
```

## Variables de Entorno

| Variable | Requerido | Default | Descripción |
|----------|-----------|---------|-------------|
| `SERVICENOW_INSTANCE_URL` | Sí | - | URL de la instancia ServiceNow (e.g., `https://giotst.service-now.com`) |
| `SERVICENOW_CLIENT_ID` | Sí | - | Client ID para OAuth2 |
| `SERVICENOW_CLIENT_SECRET` | Sí | - | Client Secret para OAuth2 |
| `SERVICENOW_USERNAME` | Sí | - | Usuario para OAuth2 password grant |
| `SERVICENOW_PASSWORD` | Sí | - | Contraseña para OAuth2 password grant |
| `SERVICENOW_TIMEOUT` | No | `30000` | Timeout de requests API en ms (rango: 1000-120000) |
| `PORT` | No | `3000` | Puerto del servidor |
| `HOST` | No | `0.0.0.0` | Host donde bindea el servidor |
| `CORS_ORIGIN` | No | `*` | Orígenes permitidos para CORS |
| `LOG_LEVEL` | No | `info` | Nivel de logging (debug, info, warn, error) |

## Endpoints de ServiceNow (Custom API)

Los endpoints están definidos en `src/constants.ts` como `ENDPOINTS`. Para cambiar de test a producción, solo modifica las rutas en ese archivo:

```typescript
// src/constants.ts
export const API_BASE_PATH = "/api/pase/lucy_ai_pacifico";
export const ENDPOINTS = {
  incidents: `${API_BASE_PATH}/getinc`,
  changes: `${API_BASE_PATH}/getchg`,
  requirements: `${API_BASE_PATH}/getritm`,
  problems: `${API_BASE_PATH}/getprb`,
} as const;
```

### Formato de Request a ServiceNow

```
GET {instanceUrl}{endpoint}?sn_query={query}&limit={limit}&{field_filter}={value}
Authorization: Bearer {access_token}
```

- **sn_query**: Query de búsqueda con sintaxis CONTAINS (e.g., `short_descriptionCONTAINSerror^ORdescriptionCONTAINSerror`)
- **limit**: Número máximo de resultados
- **Filtros por campo**: Se pasan como query params directos (e.g., `assignment_group=Squad_X`, `state=Asignado`)

### Formato de Response de ServiceNow

```json
{
  "result": {
    "result": [ ... ],
    "meta": {
      "total": 34096,
      "limit": 10,
      "offset": 0,
      "returned": 10,
      "query_used": "descriptionCONTAINSerror"
    }
  }
}
```

## Herramientas MCP Disponibles (4 tools)

| Tool | Descripción | Endpoint | Archivo |
|------|-------------|----------|---------|
| `incident_search` | Busca incidentes con filtros | `/api/pase/lucy_ai_pacifico/getinc` | `tools/incident-search.ts` |
| `problem_search` | Busca problemas registrados | `/api/pase/lucy_ai_pacifico/getprb` | `tools/problem-search.ts` |
| `requirement_search` | Busca requisitos (RITM) | `/api/pase/lucy_ai_pacifico/getritm` | `tools/requirement-search.ts` |
| `change_search` | Busca solicitudes de cambio (CHG) | `/api/pase/lucy_ai_pacifico/getchg` | `tools/change-search.ts` |

### Campos por Tool

**incident_search**: sys_id, number, short_description, description, state, priority, urgency, u_categoria, u_subcategoria_1/2/3, caller_id, assigned_to, assignment_group, opened_at, sys_updated_on, close_notes, resolution_code, resolved_at, closed_at

**change_search**: sys_id, number, short_description, description, state, type, priority, risk, assignment_group, assigned_to, requested_by, start_date, end_date, sys_created_on, sys_updated_on, cmdb_ci, justification, implementation_plan, backout_plan, close_notes, u_ambiente, u_clase_cambio, u_tipo_tecnologia, u_squad, u_asistente_cambio

**requirement_search**: sys_id, number, short_description, description, state, stage, priority, u_categoria, u_subcategoria_1/2/3, requested_for, assignment_group, assigned_to, opened_at, sys_updated_on, due_date, justification, expected_start, approval, u_empresa, u_categorias_concatenadas, pending_approvers

**problem_search**: sys_id, number, short_description, description, state, priority, impact, u_categoria, u_subcategoria_1/2/3, assigned_to, assignment_group, sys_created_on, sys_updated_on, root_cause, work_around, business_service, related_incidents, known_error, u_empresa

## Convenciones de Código

### Estructura de Tool

Cada tool sigue este patrón:

```typescript
// 1. Schema Zod para validación de parámetros
export const toolNameSchema = { ... };

// 2. Anotaciones MCP (metadata)
export const toolNameAnnotations = { ... };

// 3. Descripción para el agente
export const toolNameDescription = "...";

// 4. Handler que ejecuta la lógica
export async function handleToolName(
  client: ServiceNowClient,
  args: z.infer<typeof toolNameSchema>,
): Promise<string> {
  // Implementación
}
```

### Registro de Tools

Todos los tools se registran en `src/tools/index.ts` usando un array de definiciones y `createToolHandler()`:

```typescript
const toolDefinitions = [
  {
    name: "tool_name",
    description: toolNameDescription,
    schema: toolNameSchema,
    annotations: toolNameAnnotations,
    handler: (args) => handleToolName(client, args),
  },
];

for (const tool of toolDefinitions) {
  server.tool(tool.name, tool.description, tool.schema, tool.annotations,
    createToolHandler(tool.name, tool.handler));
}
```

`createToolHandler` agrega:
- Rate limiting (60 calls/60s)
- Correlation ID por tool call
- Child logger con contexto (callId, toolName)
- Error handling (ServiceNowApiError con mensajes específicos por status code)
- Resumen de resultados (recordCount, responseLength)

### Logging

Sistema de logging estructurado JSON en `src/services/logger.ts`:

```typescript
logger.info("message", {
  correlationId: "abc123",
  toolName: "incident_search",
  durationMs: 1234,
});
```

**Niveles**: debug, info, warn, error
**Salida**: JSON a stdout (info/debug/warn) y stderr (error) — compatible con Azure App Service Log Analytics

## Endpoints HTTP

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/` | Info del servidor |
| GET | `/health` | Health check |
| POST | `/mcp` | Endpoint MCP (JSON-RPC) |
| GET | `/mcp` | 405 - No soportado (stateless) |
| DELETE | `/mcp` | 405 - No soportado (stateless) |

## Problemas Conocidos y Soluciones

### Token OAuth Expirado

El cliente maneja esto automáticamente:
- Refresca 60 segundos antes de expirar (`TOKEN_REFRESH_BUFFER_MS`)
- Si recibe HTTP 401, obtiene nuevo token y reintenta la petición

### HTTP 429 de ServiceNow

El cliente ya maneja esto automáticamente con retry + exponential backoff. Si persiste:
- Aumenta `MAX_RETRIES` en `src/constants.ts`
- Aumenta `RETRY_BASE_DELAY_MS` en `src/constants.ts`

### Cambiar de Test a Producción

Solo modifica `src/constants.ts`:

```typescript
export const API_BASE_PATH = "/api/pase/lucy_ai_prod"; // nueva ruta base
export const ENDPOINTS = {
  incidents: `${API_BASE_PATH}/getinc`,
  changes: `${API_BASE_PATH}/getchg`,
  requirements: `${API_BASE_PATH}/getritm`,
  problems: `${API_BASE_PATH}/getprb`,
} as const;
```

Y actualiza las variables de entorno con las credenciales de producción.

## Notas de Seguridad

- **NUNCA** commitear el archivo `.env` con credenciales reales
- El `.gitignore` ya excluye `.env`
- Las credenciales OAuth se envían como POST body — usar HTTPS siempre
- Los tokens se almacenan solo en memoria (no persisten)
- Validar siempre inputs con schemas Zod

## Mantenimiento

### Agregar Nuevo Tool

1. Crear archivo `src/tools/nuevo-tool.ts`
2. Exportar: `schema`, `annotations`, `description`, `handler`
3. Importar en `src/tools/index.ts`
4. Agregar al array `toolDefinitions` dentro de `registerAllTools()`
5. Agregar endpoint en `src/constants.ts` → `ENDPOINTS`
6. Actualizar README.md y este AGENTS.md

### Actualizar Dependencias

```bash
bun update
bun run typecheck   # Verificar tipos
bun run build       # Verificar build
```

## Contacto y Soporte

- **Autor**: Angel Rios (SRE @ Pacífico Seguros)
- **Repo**: https://github.com/greenteethskull/elysia-servicenow-mcp-remote
- **Issues**: Reportar en GitHub Issues

## Licencia

MIT
