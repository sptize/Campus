# CampusPocket

PWA personal de gestión académica: horario importado desde Excel, asignaturas, notas, objetivos, evaluaciones, trabajos, calendario, copias de seguridad y modo sin conexión. Todo se guarda en el dispositivo (IndexedDB); no hay servidor, cuentas ni telemetría.

## Estructura (Visual Studio Code)

```
campuspocket/
├── index.html            página base
├── package.json          scripts y dependencias de desarrollo (esbuild, typescript)
├── tsconfig.json
├── public/               se copia tal cual a dist/ (manifest, iconos, favicon)
├── scripts/build.mjs     compila a dist/ y genera el service worker con la lista de caché
├── scripts/build-tests.mjs
├── src/
│   ├── main.ts           arranque y rutas
│   ├── config.ts         NOMBRE DE LA APP, versión, ids
│   ├── sw.ts             service worker (offline + actualización controlada)
│   ├── app/              router, cabecera/navegación, registro PWA
│   ├── db/               IndexedDB: tablas, transacciones y migraciones versionadas
│   ├── services/         lógica: importador Excel, fechas, estados, copias, calendario
│   ├── features/         pantallas: inicio, horario, asignaturas, planificador, ajustes, importar
│   ├── ui/               componentes (h, iconos, formularios, diálogos)
│   └── styles/           variables.css (colores) y main.css
├── tests/                importer.test.ts (unitarias) y e2e.mjs (navegador real)
└── dist/                 LA APP COMPILADA (lo que se publica)
```

## Usar

- Publicar sin instalar nada: sube el contenido de `dist/` a GitHub Pages (o cualquier hosting estático). Funciona en subcarpetas.
- Desarrollar: `npm install` y luego `npm run build` (compila a `dist/`), `npm run dev` (servidor en http://localhost:5173), `npm run typecheck`, `npm test` (unitarias), `npm run e2e` (necesita Playwright instalado).
- Cambiar el nombre: `src/config.ts` o Ajustes → Nombre de la app. Colores: `src/styles/variables.css`.
- Nueva versión: sube `version` en `package.json`, ejecuta `npm run build` y publica `dist/`. En el móvil: Ajustes → Actualizar app.

## Esquema de datos

Cambiar el esquema = añadir una función al final de `MIGRATIONS` en `src/db/idb.ts`. Nunca edites las anteriores: así las actualizaciones no borran datos.
