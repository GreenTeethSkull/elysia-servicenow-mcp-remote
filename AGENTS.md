# AGENTS.md — Instrucciones para Agentes de IA

Este archivo proporciona contexto esencial del proyecto **elysia-servicenow-mcp-remote** para que cualquier agente de IA pueda trabajar efectivamente en él.

## Descripción del Proyecto

Servidor MCP (Model Context Protocol) remoto para ServiceNow, construido con ElysiaJS y Bun. Expone 5 herramientas para buscar incidentes, problemas, cambios, requisitos y artículos de la base de conocimientos en una instancia de ServiceNow. Diseñado para ser consumido por agentes de IA (Claude, Cursor, etc.) vía Streamable HTTP.

## Stack Tecnológico

- **Runtime**: Bun (JavaScript/TypeScript runtime de alto rendimiento)
- **Framework Web**: ElysiaJS (ultrarrápido, type-safe)
- **Protocolo**: MCP (Model Context Protocol) via Streamable HTTP
- **Lenguaje**: TypeScript
- **Contenedorización**: Docker (multi-stage build)
- **Autenticación**: ServiceNow Basic Auth (username + password)

## Arquitectura

### Flujo de Request

```
Cliente MCP (Claude/Cursor/Agente)
  ↓ POST /mcp (JSON-RPC)
ElysiaJS Server
  ↓ Crea McpServer + StreamableHTTPServerTransport por request
McpServer (instancia aislada)
  ↓ Ejecuta tool handler
ServiceNowClient
  ↓ HTTP requests a ServiceNow Table API
ServiceNow Instance
```

### Concurrencia

**IMPORTANTE**: Cada request POST `/mcp` crea una nueva instancia de `McpServer` y `StreamableHTTPServerTransport`. Esto permite manejar múltiples requests simultáneos sin conflictos de estado compartido.

- **Antes (bug)**: Un solo `McpServer` compartido → fallaba con concurrencia > 1
- **Ahora (fix)**: `createMcpServer()` factory por request → concurrencia ilimitada

### Rate Limiting

- **Límite**: 60 tool calls por ventana de 60 segundos (global, no por cliente)
- **Configuración**: `src/constants.ts` → `RATE_LIMIT_MAX_CALLS = 60`, `RATE_LIMIT_WINDOW_MS = 60_000`
- **Implementación**: Array en memoria `toolCallTimestamps` en `src/tools/index.ts`
- **Comportamiento**: Cuando se excede, retorna error JSON-RPC con mensaje de rate limit

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
├── constants.ts                   # Constantes globales (rate limit, timeouts, retry, etc.)
├── services/
│   ├── servicenow-client.ts       # Cliente HTTP para ServiceNow Table API (Basic Auth + retry)
│   ├── servicenow-env.ts          # Validación de variables de entorno
│   └── logger.ts                  # Sistema de logging estructurado (JSON + child loggers)
├── tools/
│   ├── index.ts                   # Registro de tools + rate limiting + error handling
│   ├── kb-search.ts               # Tool: kb_search (Knowledge Base)
│   ├── incident-search.ts         # Tool: incident_search
│   ├── problem-search.ts          # Tool: problem_search
│   ├── requirement-search.ts      # Tool: requirement_search
│   └── change-search.ts           # Tool: change_search
└── utils/
    ├── formatters.ts              # Formateo de respuestas
    └── query-builder.ts           # Constructor de queries ServiceNow
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
| `SERVICENOW_INSTANCE_URL` | Sí | - | URL de la instancia ServiceNow (e.g., `https://dev12345.service-now.com`) |
| `SERVICENOW_USERNAME` | Sí | - | Usuario para Basic Auth |
| `SERVICENOW_PASSWORD` | Sí | - | Contraseña para Basic Auth |
| `SERVICENOW_TIMEOUT` | No | `30000` | Timeout de requests API en ms (rango: 1000-120000) |
| `PORT` | No | `3000` | Puerto del servidor |
| `HOST` | No | `0.0.0.0` | Host donde bindea el servidor |
| `CORS_ORIGIN` | No | `*` | Orígenes permitidos para CORS |
| `LOG_LEVEL` | No | `info` | Nivel de logging (debug, info, warn, error) |

## Herramientas MCP Disponibles (5 tools)

| Tool | Descripción | Tabla ServiceNow | Archivo |
|------|-------------|------------------|---------|
| `kb_search` | Busca artículos en Knowledge Base | `kb_knowledge` | `tools/kb-search.ts` |
| `incident_search` | Busca incidentes con filtros | `incident` | `tools/incident-search.ts` |
| `problem_search` | Busca problemas registrados | `problem` | `tools/problem-search.ts` |
| `requirement_search` | Busca requisitos | `rm_story` | `tools/requirement-search.ts` |
| `change_search` | Busca solicitudes de cambio (RFC) | `change_request` | `tools/change-search.ts` |

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
  table: "incident",
  durationMs: 1234,
});

// Child logger con contexto pre-seteado
const toolLog = logger.child({ callId, toolName: "incident_search" });
toolLog.info("Tool call started", { args: { ... } });
```

**Niveles**: debug, info, warn, error
**Salida**: JSON a stdout (info/debug/warn) y stderr (error) — compatible con Azure App Service Log Analytics

### Cliente ServiceNow

`src/services/servicenow-client.ts`:
- Usa `fetch` nativo de Bun
- Autenticación via header `Authorization: Basic <base64(user:pass)>`
- Timeout configurable (`SERVICENOW_TIMEOUT`, default 30s)
- Retry automático con exponential backoff ante HTTP 429
- Clase `ServiceNowApiError` para errores HTTP de ServiceNow
- Logging de cada API call (tabla, duración, status, record count)

## Endpoints HTTP

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/` | Info del servidor |
| GET | `/health` | Health check |
| POST | `/mcp` | Endpoint MCP (JSON-RPC) |
| GET | `/mcp` | 405 - No soportado (stateless) |
| DELETE | `/mcp` | 405 - No soportado (stateless) |

## Problemas Conocidos y Soluciones

### Bug de Concurrencia (RESUELTO)

**Problema**: Un solo `McpServer` compartido causaba fallos con requests simultáneos.

**Solución**: Crear nuevo `McpServer` por request en `server.ts`:

```typescript
function createMcpServer(snClient: ServiceNowClient): McpServer {
  const server = new McpServer({ name: "...", version: "..." }, { capabilities: { tools: {} } });
  registerAllTools(server, snClient);
  return server;
}

.post("/mcp", async ({ request, set }) => {
  const mcpServer = createMcpServer(snClient);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  // ... manejo de request
});
```

### Rate Limit Excedido

Si ves errores de rate limit:
- Aumenta `RATE_LIMIT_MAX_CALLS` en `src/constants.ts`
- Considera implementar rate limiting por cliente (actualmente es global)

### HTTP 429 de ServiceNow

El cliente ya maneja esto automáticamente con retry + exponential backoff. Si persiste:
- Aumenta `MAX_RETRIES` en `src/constants.ts`
- Aumenta `RETRY_BASE_DELAY_MS` en `src/constants.ts`

## Notas de Seguridad

- **NUNCA** commitear el archivo `.env` con credenciales reales
- El `.gitignore` ya excluye `.env`
- Las credenciales se envían como Basic Auth (base64) — usar HTTPS siempre
- Validar siempre inputs con schemas Zod

## Mantenimiento

### Agregar Nuevo Tool

1. Crear archivo `src/tools/nuevo-tool.ts`
2. Exportar: `schema`, `annotations`, `description`, `handler`
3. Importar en `src/tools/index.ts`
4. Agregar al array `toolDefinitions` dentro de `registerAllTools()`
5. Actualizar README.md y este AGENTS.md

### Actualizar Dependencias

```bash
bun update
bun run typecheck   # Verificar tipos
bun run build       # Verificar build
```

### Publicar Nueva Versión

1. Actualizar versión en `package.json` y `src/constants.ts`
2. Build multi-arquitectura Docker
3. Push a Docker Hub
4. Tag en Git

## Contacto y Soporte

- **Autor**: Angel Rios (SRE @ Pacífico Seguros)
- **Repo**: https://github.com/greenteethskull/elysia-servicenow-mcp-remote
- **Issues**: Reportar en GitHub Issues

## Licencia

MIT
