# ServiceNow MCP Server (ElysiaJS + Bun)

Servidor MCP (Model Context Protocol) remoto para ServiceNow, construido con ElysiaJS y Bun. Expone herramientas para buscar incidentes, problemas, cambios, requisitos y artículos de la base de conocimientos en tu instancia de ServiceNow.

## Características

- **Remote MCP Server**: Implementa el protocolo MCP vía Streamable HTTP (stateless)
- **TypeScript + Bun**: Código type-safe con el runtime de Bun de alto rendimiento
- **ElysiaJS**: Framework web ultrarrápido y minimalista
- **Rate Limiting**: Protección contra abusos (5 llamadas por minuto)
- **Docker Ready**: Despliegue contenedorizado listo para producción

## Herramientas Disponibles

El servidor expose las siguientes 5 herramientas (tools) MCP:

| Herramienta | Descripción |
|-------------|-------------|
| `kb_search` | Busca artículos en la Base de Conocimientos de ServiceNow. Ideal para encontrar procedimientos, guías técnicas, soluciones documentadas y mejores prácticas. |
| `incident_search` | Busca incidentes en ServiceNow. Útil para revisar problemas similares y sus soluciones implementadas. Soporta filtros por estado, prioridad, categoría y urgencia. |
| `problem_search` | Busca problemas registrados en ServiceNow. Permite analizar problemas conocidos y sus soluciones de raíz. |
| `requirement_search` | Busca requisitos en el sistema de Gestión de Requisitos de ServiceNow. |
| `change_search` | Busca solicitudes de cambio (RFC) en ServiceNow. Útil para revisar cambios planificados o realizados en la infraestructura. |

## Requisitos Previos

- [Bun](https://bun.sh) >= 1.0 (runtime de JavaScript)
- Docker (para despliegue en contenedor)
- Cuenta de ServiceNow con acceso API (Basic Auth)

## Configuración

### Variables de Entorno

Crea un archivo `.env` basado en el ejemplo:

```bash
cp .env.example .env
```

Edita `.env` con tus credenciales:

```env
# Required
SERVICENOW_INSTANCE_URL=https://tu-instancia.service-now.com
SERVICENOW_USERNAME=tu-usuario
SERVICENOW_PASSWORD=tu-contraseña

# Optional
SERVICENOW_TIMEOUT=30000
PORT=3000
HOST=0.0.0.0
CORS_ORIGIN=*
LOG_LEVEL=info
```

## Desarrollo Local

### 1. Instalar dependencias

```bash
bun install
```

### 2. Configurar credenciales

Crea el archivo `.env` con tus credenciales de ServiceNow (ver sección anterior).

### 3. Ejecutar en modo desarrollo

```bash
bun run dev
```

El servidor arrancará en `http://localhost:3000` con hot-reload.

### 4. Endpoints disponibles

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/` | GET | Información del servidor |
| `/health` | GET | Health check |
| `/mcp` | POST | Endpoint MCP (envía requests JSON-RPC) |

## Docker

### Build de la imagen

```bash
docker build -t elysia-servicenow-mcp-remote .
```

### Ejecutar el contenedor

Con variables de entorno en línea:

```bash
docker run -p 3000:3000 \
  -e SERVICENOW_INSTANCE_URL=https://tu-instancia.service-now.com \
  -e SERVICENOW_USERNAME=tu-usuario \
  -e SERVICENOW_PASSWORD=tu-contraseña \
  elysia-servicenow-mcp-remote
```

Con archivo `.env`:

```bash
docker run -p 3000:3000 --env-file .env elysia-servicenow-mcp-remote
```

### Verificar funcionamiento

```bash
# Health check
curl http://localhost:3000/health

# Info del servidor
curl http://localhost:3000/
```

## Publicar en Docker Hub

Build y push multi-plataforma (AMD64 + ARM64):

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t tu-usuario-dockerhub/elysia-servicenow-mcp-remote:latest \
  --push .
```

Ejemplo con tu usuario:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t greenteethskull/elysia-servicenow-mcp-remote:latest \
  --push .
```

## Uso con Claude / OpenCode

Una vez ejecutado el servidor, puedes conectarlo como MCP remoto. La configuración depende del cliente MCP que utilices.

Endpoint MCP: `http://localhost:3000/mcp`

## Scripts Disponibles

| Comando | Descripción |
|---------|-------------|
| `bun run dev` | Desarrollo con hot-reload |
| `bun run start` | Producción (requiere build) |
| `bun run build` | Compila a binario standalone |
| `bun run typecheck` | Verifica tipos TypeScript |
| `bun run docker:build` | Build de imagen Docker |
| `bun run docker:run` | Ejecuta contenedor con .env |

## Estructura del Proyecto

```
src/
├── index.ts          # Entry point
├── server.ts         # Servidor Elysia + MCP
├── constants.ts      # Constantes globales
├── services/
│   ├── servicenow-client.ts   # Cliente REST de ServiceNow
│   ├── servicenow-env.ts      # Carga de variables de entorno
│   └── logger.ts              # Logging
├── tools/
│   ├── index.ts           # Registro de herramientas
│   ├── kb-search.ts       # Búsqueda de KB
│   ├── incident-search.ts # Búsqueda de incidentes
│   ├── problem-search.ts  # Búsqueda de problemas
│   ├── requirement-search.ts # Búsqueda de requisitos
│   └── change-search.ts   # Búsqueda de cambios
└── utils/
    ├── formatters.ts      # Formateo de respuestas
    └── query-builder.ts   # Constructor de queries
```

## Licencia

MIT
