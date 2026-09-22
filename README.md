# YORI-TEX · Gestor de pedidos

> Este paquete ya está conectado a tu proyecto de Supabase. Mientras utilices el mismo proyecto, no necesitas volver a editar `js/config.js`.

Aplicación privada para administrar cierres de pedido, clientes, capturas, anticipos, compras Temu, partes divididas, llegadas, libras, costos, ganancias y comprobantes.

La aplicación utiliza:

- **GitHub Pages:** publica los archivos HTML, CSS y JavaScript.
- **Supabase Auth:** inicio de sesión con correo y contraseña.
- **Supabase Database:** guarda y sincroniza todos los registros.
- **Supabase Storage:** guarda las capturas en un contenedor privado.
- **Supabase Realtime:** actualiza otra pestaña o dispositivo cuando cambia la información.

No utiliza Google Sheets ni Google Apps Script.

## 1. Crear el proyecto en Supabase

1. Entra en [https://supabase.com](https://supabase.com) y crea una cuenta.
2. Presiona **New project**.
3. Escribe un nombre, por ejemplo: `yori-tex-pedidos`.
4. Crea una contraseña segura para la base de datos y guárdala. No debes pegarla en la aplicación ni enviársela a nadie.
5. Elige la región más cercana disponible y espera a que el proyecto termine de crearse.

## 2. Crear la base de datos y la seguridad

1. Dentro del proyecto de Supabase, abre **SQL Editor**.
2. Presiona **New query**.
3. Abre en tu computadora el archivo `supabase/configuracion.sql`.
4. Copia todo su contenido y pégalo en SQL Editor.
5. Presiona **Run**.
6. Debe aparecer un mensaje de ejecución correcta.

Este script crea las tablas, relaciones, políticas de seguridad, almacenamiento privado y sincronización en tiempo real.

> El script está preparado para ejecutarse nuevamente si una parte ya existe. No modifiques las políticas de seguridad sin revisar primero su efecto.

## 3. Crear tu usuario propietario

1. En Supabase abre **Authentication** → **Users**.
2. Presiona **Add user** o **Create new user**.
3. Escribe el correo con el que entrarás a YORI-TEX.
4. Crea una contraseña segura.
5. Marca la opción para confirmar automáticamente el correo, si aparece.
6. Guarda el usuario.

No escribas esa contraseña dentro de ningún archivo. La contraseña solo se utiliza en la pantalla de inicio de sesión.

### Impedir registros de otras personas

En **Authentication** → **Providers** → **Email**, desactiva la opción que permite nuevos registros públicos o `Allow new users to sign up`. El usuario que creaste manualmente seguirá funcionando.

## 4. Obtener los dos datos públicos de Supabase

En Supabase abre **Project Settings** → **API**. Dependiendo de la versión del panel, también puede aparecer como **Connect**.

Copia solamente:

1. **Project URL**: tiene una forma parecida a `https://abcdefgh.supabase.co`.
2. **Publishable key** o **anon public key**.

Nunca copies ni publiques:

- `service_role key`.
- Contraseña de la base de datos.
- Contraseña de tu usuario.
- Tokens personales.

## 5. Conectar el index con Supabase

Abre el archivo `js/config.js` y reemplaza los textos de ejemplo:

```js
export const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'TU_CLAVE_PUBLICA';
```

Guarda el archivo. La Publishable key es una clave pública para el navegador; la protección real está en las políticas RLS creadas por el script.

## 6. Subir la aplicación manualmente a GitHub

1. Entra en [https://github.com](https://github.com).
2. Presiona **New repository**.
3. Escribe un nombre, por ejemplo: `yori-tex-pedidos`.
4. Si tu plan de GitHub admite Pages desde repositorios privados, puedes elegir **Private**. En GitHub Free normalmente deberás usar **Public** para publicar con Pages. El código podrá verse, pero las contraseñas, capturas y registros continúan protegidos en Supabase.
5. No marques opciones que creen archivos adicionales, porque esta carpeta ya contiene todo.
6. Presiona **Create repository**.
7. Dentro del repositorio selecciona **Add file** → **Upload files**.
8. Sube **todo el contenido** de esta carpeta, conservando estas carpetas:

```text
assets/
css/
js/
supabase/
index.html
manifest.webmanifest
.nojekyll
README.md
```

9. Presiona **Commit changes**.

### Activar GitHub Pages

1. Abre **Settings** del repositorio.
2. En el menú izquierdo abre **Pages**.
3. En **Build and deployment**, selecciona **Deploy from a branch**.
4. Selecciona la rama `main` y la carpeta `/(root)`.
5. Presiona **Save**.
6. GitHub mostrará una dirección parecida a:

```text
https://TU-USUARIO.github.io/yori-tex-pedidos/
```

La pantalla de inicio de sesión podrá verse desde internet, pero los datos no podrán consultarse sin un usuario válido de Supabase.

## 7. Autorizar la dirección de GitHub en Supabase

Después de conocer tu dirección de GitHub Pages:

1. Abre Supabase → **Authentication** → **URL Configuration**.
2. En **Site URL** pega la dirección completa de GitHub Pages.
3. En **Redirect URLs** agrega la misma dirección.
4. Guarda los cambios.

Esto permite que la recuperación de contraseña regrese correctamente a la aplicación.

## 8. Primera prueba

1. Abre la dirección de GitHub Pages.
2. Inicia sesión con el usuario creado en Supabase.
3. Crea un cierre.
4. Añade una persona con una captura.
5. Registra un anticipo.
6. Cierra la página y vuelve a abrirla.
7. Confirma que la información continúa guardada.
8. Abre la aplicación en el celular y comprueba que aparece el mismo cierre.

## 9. Funciones incluidas

- Inicio y cierre de sesión.
- Recuperación de contraseña.
- Cierres por fecha.
- Personas y capturas privadas.
- Valor de productos y anticipo sugerido del 50 %.
- Pagos adicionales y saldo a favor.
- Mensajes de pago y enlace directo a WhatsApp.
- Compras Temu separadas por cuenta, fecha y costo real.
- División de un cliente entre distintas compras.
- Llegadas completas, con faltantes, perdidas o canceladas.
- Descuentos por productos que no llegaron.
- Entregas parciales con partes pendientes.
- Libras acumuladas con cobro mínimo y máximo configurables.
- Ganancia de productos, ingreso por libras y ganancia total.
- Comprobante YORI-TEX con logo, marca de agua y capturas.
- Copiar, compartir y descargar el comprobante como PNG.
- Sincronización automática mediante Supabase Realtime.
- Diseño adaptable para computadora y celular.

## 10. Reglas del cobro de libras

La configuración inicial es:

- Valor por libra: **$4,00**.
- Cobro mínimo: **$4,00**.
- Cobro máximo: **$10,00**.

El sistema suma el peso de todas las entregas del mismo cliente y aplica el mínimo y el máximo una sola vez.

Ejemplo:

- Primera entrega: 0,90 lb → cobro acumulado $4,00.
- Segunda entrega: 1,20 lb → peso acumulado 2,10 lb → cobro acumulado $8,40.
- El aumento real del segundo cobro es $4,40.

## 11. Seguridad importante

- No publiques la clave `service_role`.
- No guardes contraseñas dentro de `config.js`.
- No conviertas el contenedor `client-captures` en público.
- No desactives RLS en las tablas.
- Crea usuarios adicionales únicamente desde Supabase si en el futuro otra persona necesita entrar.
- Las capturas se entregan a la aplicación mediante enlaces temporales firmados.

## 12. Actualizar la aplicación

Para instalar una actualización futura:

1. Descarga los archivos nuevos.
2. En GitHub reemplaza los archivos correspondientes.
3. Presiona **Commit changes**.
4. GitHub Pages publicará la versión nueva automáticamente.

Los datos no se perderán porque permanecen en Supabase, no dentro de los archivos de GitHub.

## Solución rápida de problemas

### Aparece “Configuración pendiente”

Revisa que `js/config.js` tenga la Project URL y la Publishable key correctas, entre comillas.

### No permite iniciar sesión

- Confirma que el usuario existe en Authentication → Users.
- Revisa que el correo esté confirmado.
- Verifica que no hayas pegado la clave `service_role`.

### No permite subir capturas

- Ejecuta nuevamente `supabase/configuracion.sql`.
- Comprueba que exista el bucket privado `client-captures`.
- El tamaño máximo configurado por captura es 10 MB.

### La recuperación de contraseña abre una dirección incorrecta

Revisa Site URL y Redirect URLs en Authentication → URL Configuration.
