# Cerdito Cornudo

Aplicación web adaptable a móviles para registrar pedidos del restaurante, consultar ventas y administrar la carta. Los datos operativos se guardan en Supabase.

## Abrir la aplicación

Al publicarse con GitHub Pages, la dirección será `https://juanmajeje11.github.io/cerdito-cornudo/`.

## Desarrollo

La aplicación es estática: abre `index.html` con un servidor local o publica los archivos de la raíz. La configuración de conexión está en `config.js` y usa una clave publicable de Supabase; nunca agregues claves secretas ni archivos `.env` al repositorio.

## Estructura

- `index.html`, `styles.css`, `app.js`, `online.js`: interfaz y comportamiento web.
- `config.js`: URL y clave publicable del proyecto Supabase.
- `supabase/`: esquema, migraciones, endurecimiento y función Edge.
- `assets/`: logo del restaurante.

La carta y los precios actuales están en la base de datos del proyecto Supabase.
