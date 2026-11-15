# SMSPVA TERM

Aplicación local (interfaz web/escritorio con Node.js + React) y CLI multiplataforma en Python para consultar precios, pedir activaciones y recibir SMS mediante SMSPVA Activation API v2.

> Úsalo únicamente con una cuenta y saldo autorizados. Este proyecto no incluye ni solicita publicar credenciales.

## Interfaz local de escritorio / web (Node.js)

### Requisitos

- **Node.js 22 o posterior** (verificado en `package.json`: `"node": ">=22"`).
- En Windows, Edge o Chrome instalado para abrir la ventana `--app` automáticamente (si no se encuentran, se abre en el navegador predeterminado).

### Arranque rápido

- **Windows (doble clic o terminal):** ejecuta `Start-SMSPVA.bat` (o `Start-SMSPVA.ps1`). Comprueba Node.js >=22, instala dependencias (`npm.cmd install`) si falta `node_modules`, compila la interfaz (`npm.cmd run build:ui`) si falta `ui-dist` y arranca `node server/server.js`.
- **Manual (Windows / macOS):**
  ```bash
  npm install
  npm run build:ui
  npm start
  ```
- El servidor local escucha en `127.0.0.1` con un token de sesión local (`x-smspva-token`) y abre automáticamente la ventana de la aplicación. Para iniciar sin abrir ventana automáticamente, usa `SMSPVA_NO_OPEN=1 npm start`.

### Pestañas de la interfaz

- **Operación:**
  - **Favoritos (1 clic):** guarda y reutiliza combinaciones frecuentes de servicio, país y operador.
  - **Pedir número:** selecciona servicio, país y operador con precios/stock en vivo y solicita un número temporal.
  - **Órdenes activas:** consulta SMS recibidos, copia el número o código con un clic, limpia SMS (`clear`), repite número (`repeat`), cancela (`cancel`) o reporta/bloquea (`block`).
- **Configuración:**
  - **API Key de SMSPVA:** valida, guarda o elimina la clave de SMSPVA.
  - **Bloqueo por token (AccessGate):** administra el token privado de acceso.
  - **Actualizaciones (Updater):** configura el token de actualización y verifica nuevas versiones.

### AccessGate (control de acceso privado)

Al iniciar, `AccessGate` verifica el acceso contra el repositorio privado `Kiwy-dev/kiwyrium-reportes` mediante un token de GitHub (`github_pat_...` o `ghp_...`):

- Se lee desde `~/.credentials/kiwyrium-reports.env` (clave `KIWYRIUM_REPORTS_TOKEN`) o desde la variable de entorno `KIWYRIUM_REPORTS_TOKEN`.
- Si falta el token o es rechazado, la aplicación arranca bloqueada (`423` en rutas de operación) hasta desbloquearse desde la pantalla inicial o `Configuración`.
- En entornos locales o pruebas sin verificación remota, puede desactivarse con `SMSPVA_ACCESS_GATE=0`.

### Actualizaciones (Updater)

El módulo `Updater` consulta releases de `Kiwy-dev/SMSPVA-TERM` en GitHub, valida la suma `SHA256SUMS.txt` y descarga el paquete correspondiente a la plataforma:

- El token (`github_pat_...` o `ghp_...`) se guarda en `~/.credentials/smspva-update.env` (clave `SMSPVA_UPDATE_TOKEN`) o se lee desde la variable de entorno `SMSPVA_UPDATE_TOKEN`.

---

## CLI clásico en Python (`smspva.py`)

El cliente original de terminal sigue disponible y funcional junto a la nueva interfaz.

### Requisitos

Python 3.9+ en Windows y macOS. Abre una terminal dentro de esta carpeta.

Arranque automático: ejecuta `py smspva.py` (Windows) o `python3 smspva.py` (macOS). Antes de cargar la interfaz comprueba Rich, keyring y phonenumbers. Si falta alguno, crea `.venv-smspva` junto al programa, instala `requirements.txt` y abre la app con ese Python. Requiere internet la primera vez y permiso de escritura en la carpeta. No instala paquetes en el Python del sistema. Conserva `requirements.txt` junto a `smspva.py`. Las instrucciones manuales siguientes son opcionales.

Windows:
```bash
py -m pip install -r requirements.txt
py smspva.py
```

macOS:
```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python smspva.py
```

Introduce la API key en el prompt oculto. Tras validarla se guarda en Keychain de macOS o Credential Manager de Windows y se reutiliza al abrir. También admite `SMSPVA_API_KEY` como variable de entorno (tiene prioridad). Si el almacén seguro falla, continúa sin guardar. La opción 3 borra la clave guardada; no borra variables de entorno. No guarda SMS en archivos.

Interfaz con Rich: encabezado, ruta y tablas. Saldo arriba a la derecha, actualizado al entrar al menú principal; durante la selección muestra la última lectura. Si la consulta falla indica no disponible. La API no declara moneda en balance. Al actualizar instala de nuevo `requirements.txt`. El sistema puede pedir autorización para acceder al llavero.

Selecciona app/servicio, país con precios y operador. COMPRAR pide un número temporal. Introduce el prefijo+número en la plataforma y solicita el SMS; se muestra el código exacto y mensaje completo. El menú permite pedir otro, retomar órdenes o cancelarlas.

Cada paso muestra una ruta, por ejemplo: `Inicio > Pedir número > Facebook > Mexico > Operador`. En la selección de número, `q` + Enter (también `Q`) retrocede un solo nivel: confirmación → operadores → países → servicios → búsqueda → inicio. Las selecciones anteriores se conservan al retroceder.

Esta versión usa Activation v2, no renta por semanas/meses ni crea cuentas automáticamente. Los precios y stock se consultan en vivo; el esquema no especifica moneda. La disponibilidad y tarifa pueden cambiar antes de pedir el número.

Consultas cada 5 segundos. Sin SMS al aproximarse 580 segundos reporta el número con `blocknumber`. `Ctrl+C` vuelve al menú sin cancelar; usa Órdenes para retomar/cancelar. Una compra con fallo de red no se reintenta: puede haberse creado. Consulta Órdenes antes de repetirla.

## Seguridad

- La API key y los tokens privados nunca deben incluirse en el repositorio, capturas ni archivos de ejemplo.
- En el CLI de Python, la API key se solicita de forma oculta, se puede leer desde `SMSPVA_API_KEY` y, en macOS/Windows, se guarda en el almacén seguro del sistema.
- En la aplicación Node.js, las credenciales locales se almacenan en `~/.credentials/` (`kiwyrium-reports.env`, `smspva-update.env`) y nunca deben subirse a Git.
- Usa `.env.example` solo como referencia; el valor real debe permanecer local.
- Si una clave o token se expone, revócalo y genera otro inmediatamente.

## Pruebas y alcance

Las pruebas usan respuestas simuladas (`npm test`); no compran números ni verifican SMS reales. Esta versión usa Activation v2 y no crea cuentas automáticamente.

Fuentes: [Activation v2](https://docs.smspva.com/#tag/activation_v2_all_methods) y [listas](https://docs.smspva.com/#tag/activation_v2_lists).
