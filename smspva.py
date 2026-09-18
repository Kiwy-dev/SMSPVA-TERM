"""SMSPVA Activation v2. Python 3.9+, Windows/macOS."""
import getpass
import html
import json
import os
import sys
from pathlib import Path
import subprocess
import importlib.util
import time
import tempfile


def setup_step(command, label, timeout=180):
    """Show honest activity/time rather than an invented percentage."""
    start = time.monotonic()
    with tempfile.TemporaryFile(mode='w+b') as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
        try:
            while process.poll() is None:
                elapsed = int(time.monotonic() - start)
                spinner = '|/-\\'[elapsed % 4]
                print(f'\r[{spinner}] {label} · {elapsed}s / máximo {timeout}s', end='', flush=True)
                if elapsed >= timeout:
                    raise RuntimeError(f'{label}: se agotó el tiempo. Revisa conexión o configuración de pip.')
                time.sleep(0.25)
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            print()
        log.seek(0)
        output = log.read().decode('utf-8', errors='replace')
        if process.returncode:
            print(output[-4000:])
            raise RuntimeError(f'{label}: terminó con error {process.returncode}.')
        print(f'✓ {label} completado ({int(time.monotonic()-start)}s).')


def ensure_dependencies():
    """Bootstrap before importing external packages; never modify system Python."""
    packages = ('rich', 'keyring', 'phonenumbers')
    if all(importlib.util.find_spec(name) is not None for name in packages):
        return
    folder = Path(__file__).resolve().parent
    env = folder / '.venv-smspva'
    python = env / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if os.environ.get('SMSPVA_BOOTSTRAPPED') == '1':
        raise RuntimeError('Las dependencias siguen sin estar disponibles después de instalar.')
    print('Preparando dependencias de SMSPVA (solo la primera vez)…', flush=True)
    if not python.exists():
        setup_step([sys.executable, '-m', 'venv', str(env)], '1/3 Crear entorno', 120)
    check = subprocess.run([str(python), '-c', 'import rich, keyring, phonenumbers'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
    if check.returncode:
        setup_step([str(python), '-m', 'pip', 'install', '--disable-pip-version-check',
                    '--timeout', '15', '--retries', '1', '-r', str(folder / 'requirements.txt')],
                   '2/3 Descargar e instalar dependencias', 180)
    print('3/3 Abriendo SMSPVA…', flush=True)
    child_env = os.environ.copy()
    child_env['SMSPVA_BOOTSTRAPPED'] = '1'
    result = subprocess.run([str(python), str(Path(__file__).resolve()), *sys.argv[1:]], env=child_env)
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    try:
        ensure_dependencies()
    except (OSError, RuntimeError, subprocess.SubprocessError) as exc:
        print('No se pudieron preparar las dependencias. Revisa internet y permisos de esta carpeta.')
        print('Vuelve a ejecutar el programa para reintentar. Detalle:', exc)
        raise SystemExit(1)
    except KeyboardInterrupt:
        print('\nInstalación interrumpida. Puedes reintentar abriendo el programa.')
        raise SystemExit(130)

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text

console = Console(markup=False, highlight=False)
balance_label = 'Saldo: —'


def vault():
    if sys.platform == 'darwin':
        from keyring.backends.macOS import Keyring
        return Keyring()
    if sys.platform == 'win32':
        from keyring.backends.Windows import WinVaultKeyring
        return WinVaultKeyring()
    raise RuntimeError('Almacén seguro no disponible')


def refresh_balance(api):
    global balance_label
    try:
        balance_label = 'Saldo: ' + str(api.call('balance')['balance'])
    except (APIError, KeyError, TypeError, ValueError):
        balance_label = 'Saldo: no disponible'


def header(*parts):
    if console.is_terminal:
        console.clear()
    grid = Table.grid(expand=True)
    grid.add_column(ratio=1)
    grid.add_column(justify='right')
    grid.add_row(Text('SMSPVA · Activation v2', style='bold cyan'), Text(balance_label, style='bold green'))
    console.print(Panel(grid, border_style='cyan'))
    console.print(Text(' > '.join(['Inicio', *parts]), style='bold cyan'))

import re
import time
import urllib.error
import urllib.parse
import urllib.request


class APIError(Exception):
    pass


def safe(value):
    return ''.join(c for c in str(value) if c.isprintable() or c == '\n')


class API:
    def __init__(self, key):
        self.key, self.last = key, 0

    def call(self, path, method='GET'):
        time.sleep(max(0, 5 - (time.monotonic() - self.last)))
        self.last = time.monotonic()
        req = urllib.request.Request('https://api.smspva.com/activation/' + path,
                                     headers={'apikey': self.key}, method=method)
        try:
            try:
                response = urllib.request.urlopen(req, timeout=15)
            except urllib.error.HTTPError as exc:
                response = exc
            with response:
                data = json.load(response)
        except (OSError, ValueError):
            raise APIError('Error de conexión. Si pediste un número, consulta Órdenes antes de repetir.') from None
        if data.get('statusCode') == 202:
            return None
        if data.get('statusCode') != 200:
            raise APIError(safe(str(data.get('error', {})).replace(self.key, '[KEY]')))
        return data['data']


def services():
    with urllib.request.urlopen('https://docs.smspva.com/json/schema.php?lang=en', timeout=30) as r:
        spec = json.loads(r.read().decode(), strict=False)
    text = next(t['description'] for t in spec['tags'] if t['name'] == 'activation_v2_lists')
    result = {}
    for line in text.splitlines():
        parts = [p.strip() for p in line.split('|')]
        if len(parts) >= 4 and re.fullmatch(r'opt\d+', parts[-1]):
            result[parts[-1]] = html.unescape(parts[-2]).strip()
    if not result:
        raise APIError('No se pudo leer el catálogo oficial.')
    return result


def choose(rows, label):
    if not rows:
        raise APIError('No hay opciones disponibles.')
    table = Table('Opción', 'Descripción', border_style='blue', expand=True)
    for i, row in enumerate(rows, 1):
        table.add_row(str(i), Text(safe(label(row))))
    console.print(table)
    while True:
        value = input('Número de opción (q = volver): ').strip()
        if value.lower() == 'q':
            return None
        if value.isdigit() and 1 <= int(value) <= len(rows):
            return rows[int(value)-1]


def phone(order):
    prefix = str(order.get('countryCode', ''))
    number = str(order['phoneNumber'])
    if re.fullmatch(r'\+?\d+', prefix):
        return '+' + prefix.lstrip('+') + number
    import phonenumbers
    code = phonenumbers.country_code_for_region('GB' if prefix == 'UK' else prefix)
    if not code:
        raise APIError('Prefijo desconocido; consulta la orden en SMSPVA.')
    return '+' + str(code) + number


def display_sms(sms):
    print('\nCódigo recibido: ' + safe(sms['code']))
    print(safe(sms.get('fullText', '')) + '\a')


def wait_sms(api, order):
    oid = order['orderId']
    print(f'\nOrden: {oid} · Número: {phone(order)}')
    if (order.get('sms') or {}).get('code'):
        display_sms(order['sms'])
        return
    print('Introduce el número en la app y solicita el SMS. Esperando…')
    print('Ctrl+C vuelve al menú; Órdenes permite retomar o cancelar.')
    deadline = time.monotonic() + max(0, min(580, int(order.get('orderExpireIn', 600))-20))
    while time.monotonic() < deadline:
        data = api.call(f'sms/{oid}')
        if data and (data.get('sms') or {}).get('code'):
            display_sms(data['sms'])
            return
    print('Sin SMS dentro del plazo: reportando el número…')
    api.call(f'blocknumber/{oid}', 'PUT')
    print('Número reportado como no funcional.')


def breadcrumb(*parts):
    header(*parts)


def buy(api, catalog):
    step = 0
    while True:
        if step == 0:
            breadcrumb('Pedir número', 'Buscar servicio')
            query = input('App/servicio (Enter = todos, q = volver): ').strip().casefold()
            if query == 'q':
                return
            rows = [(c, n) for c, n in catalog.items() if query in n.casefold() or query == c]
            if not rows:
                print('Sin coincidencias. Prueba otro nombre.')
                continue
            step = 1
        elif step == 1:
            breadcrumb('Pedir número', 'Servicios: ' + (query or 'todos'))
            selected = choose(rows, lambda s: f'{s[1]} ({s[0]})')
            if selected is None:
                step = 0
                continue
            code, name = selected
            pricing = api.call('serviceprices/' + code)
            countries = [c for c in pricing['clist'] if any(int(o['count']) > 0 for o in c['opers'])]
            if not countries:
                print('Sin países disponibles para este servicio.')
                continue
            step = 2
        elif step == 2:
            breadcrumb('Pedir número', name, 'País')
            country = choose(countries, lambda c: f"{c['cname']} ({c['ccode']}) · desde "
                             f"{min(float(o['price']) for o in c['opers'] if int(o['count']) > 0):.4g}")
            step = 1 if country is None else 3
        elif step == 3:
            breadcrumb('Pedir número', name, country['cname'], 'Operador')
            operator = choose([o for o in country['opers'] if int(o['count']) > 0],
                              lambda o: f"{o['opcode']} · precio {o['price']} · stock "
                              + ('sin cantidad exacta' if int(o['count']) == 9999 else str(o['count'])))
            step = 2 if operator is None else 4
        else:
            breadcrumb('Pedir número', name, country['cname'], operator['opcode'], 'Confirmar')
            print(f"Precio API: {operator['price']}")
            print('Precio por activación. La API no declara moneda; verifica la de tu saldo.')
            answer = input('COMPRAR para usar tu saldo; q para volver: ').strip()
            if answer.lower() == 'q':
                step = 3
                continue
            if answer != 'COMPRAR':
                continue
            path = '/'.join(urllib.parse.quote(str(x), safe='') for x in [country['ccode'], code, operator['opcode']])
            order = api.call('number/' + path + '?voice=0')
            breadcrumb('Pedir número', name, country['cname'], operator['opcode'], 'SMS')
            print('Orden creada: ' + str(order['orderId']))
            wait_sms(api, order)
            input('\n¿Quieres pedir otro número? Enter para regresar al menú: ')
            return


def main():
    header()
    store = None
    saved = None
    try:
        store = vault()
        saved = store.get_password('smspva-terminal', 'apikey')
    except Exception:
        console.print('Llavero no disponible: la clave se usará solo durante esta sesión.')
    key = os.getenv('SMSPVA_API_KEY') or saved or getpass.getpass('API key (oculta): ').strip()
    if not key:
        return
    api, catalog = API(key), None
    # Validar antes de guardar una nueva credencial.
    try:
        api.call('balance')
    except APIError as exc:
        console.print(safe(exc))
        if saved and store:
            if input('¿Borrar la clave guardada? [s/N]: ').strip().lower() == 's':
                store.delete_password('smspva-terminal', 'apikey')
        return
    if store and key != saved:
        try:
            store.set_password('smspva-terminal', 'apikey', key)
            console.print('API key guardada en el almacén seguro del sistema.')
        except Exception:
            console.print('No se pudo guardar: continuará solo en esta sesión.')
    while True:
        try:
            refresh_balance(api)
            header()
            action = input('\n1. Pedir número / precios\n2. Órdenes / recibir o cancelar\n3. Borrar API key guardada y salir\n0. Salir\n> ').strip()
            if action == '0':
                return
            if action == '3':
                try:
                    if store and store.get_password('smspva-terminal', 'apikey'):
                        store.delete_password('smspva-terminal', 'apikey')
                    console.print('Clave guardada eliminada. SMSPVA_API_KEY, si existe, se administra por separado.')
                except Exception:
                    console.print('No se pudo borrar del llavero. Revísalo desde el sistema operativo.')
                return
            if action == '1':
                if catalog is None:
                    catalog = services()
                buy(api, catalog)
            elif action == '2':
                header('Órdenes')
                order = choose(api.call('orders')['orders'], lambda o: f"{o['orderId']} · {o.get('service', '')} · {o['phoneNumber']} · {o.get('status', '')}")
                if order:
                    if input('Enter = recibir SMS; C = cancelar orden: ').strip().lower() == 'c':
                        api.call(f"cancelorder/{order['orderId']}", 'PUT')
                        print('Cancelación confirmada por la API.')
                    else:
                        wait_sms(api, order)
        except KeyboardInterrupt:
            print('\nInterrumpido. Consulta las órdenes en el menú 2.')
        except EOFError:
            return
        except (APIError, OSError, ValueError, KeyError, TypeError) as exc:
            print(safe(exc) if isinstance(exc, APIError) else 'Respuesta inesperada. Consulta Órdenes antes de repetir una compra.')


if __name__ == '__main__':
    main()
