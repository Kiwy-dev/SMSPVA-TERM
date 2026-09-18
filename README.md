# SMSPVA TERM

Terminal multiplataforma para consultar precios, pedir activaciones y recibir SMS mediante SMSPVA Activation API v2.

> Úsalo únicamente con una cuenta y saldo autorizados. Este proyecto no incluye ni solicita publicar credenciales.

## Requisitos

Python 3.9+ en Windows y macOS. Abre una terminal dentro de esta carpeta.

Arranque automático: ejecuta `py smspva.py` (Windows) o `python3 smspva.py` (macOS). Antes de cargar la interfaz comprueba Rich, keyring y phonenumbers. Si falta alguno, crea `.venv-smspva` junto al programa, instala requirements.txt y abre la app con ese Python. Requiere internet la primera vez y permiso de escritura en la carpeta. No instala paquetes en el Python del sistema. Conserva requirements.txt junto a smspva.py. Las instrucciones manuales siguientes son opcionales.

Windows:
```
py -m pip install -r requirements.txt
py smspva.py
```

macOS:
```
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python smspva.py
```

Introduce la API key en el prompt oculto. Tras validarla se guarda en Keychain de macOS o Credential Manager de Windows y se reutiliza al abrir. También admite SMSPVA_API_KEY como variable de entorno (tiene prioridad). Si el almacén seguro falla, continúa sin guardar. La opción 3 borra la clave guardada; no borra variables de entorno. No guarda SMS en archivos.

Interfaz con Rich: encabezado, ruta y tablas. Saldo arriba a la derecha, actualizado al entrar al menú principal; durante la selección muestra la última lectura. Si la consulta falla indica no disponible. La API no declara moneda en balance. Al actualizar instala de nuevo requirements.txt. El sistema puede pedir autorización para acceder al llavero.

Selecciona app/servicio, país con precios y operador. COMPRAR pide un número temporal. Introduce el prefijo+número en la plataforma y solicita el SMS; se muestra el código exacto y mensaje completo. El menú permite pedir otro, retomar órdenes o cancelarlas.

Cada paso muestra una ruta, por ejemplo: Inicio > Pedir número > Facebook > Mexico > Operador. En la selección de número, q + Enter (también Q) retrocede un solo nivel: confirmación → operadores → países → servicios → búsqueda → inicio. Las selecciones anteriores se conservan al retroceder.

Esta versión usa Activation v2, no renta por semanas/meses ni crea cuentas automáticamente. Los precios y stock se consultan en vivo; el esquema no especifica moneda. La disponibilidad y tarifa pueden cambiar antes de pedir el número.

Consultas cada 5 segundos. Sin SMS al aproximarse 580 segundos reporta el número con blocknumber. Ctrl+C vuelve al menú sin cancelar; usa Órdenes para retomar/cancelar. Una compra con fallo de red no se reintenta: puede haberse creado. Consulta Órdenes antes de repetirla.

## Seguridad

- La API key se solicita de forma oculta, se puede leer desde `SMSPVA_API_KEY` y, en macOS/Windows, se guarda en el almacén seguro del sistema.
- No guardes claves, tokens, respuestas privadas ni archivos `.env` en el repositorio.
- Usa `.env.example` solo como referencia; el valor real debe permanecer local.
- Si una clave se expone, revócala y genera otra desde SMSPVA.

## Pruebas y alcance

Las pruebas usan respuestas simuladas; no compran números ni verifican SMS reales. Esta versión usa Activation v2 y no crea cuentas automáticamente.

Fuentes: [Activation v2](https://docs.smspva.com/#tag/activation_v2_all_methods) y [listas](https://docs.smspva.com/#tag/activation_v2_lists).

Código multiplataforma. Windows no se ejecutó durante esta entrega.
