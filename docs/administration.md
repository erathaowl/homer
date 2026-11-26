# Administration

The Docker image includes a Vue administration interface at /admin/ (or under SUBFOLDER). Set both environment variables to enable it. The public dashboard remains available without admin authentication. Static ZIP deployments remain read-only.

~~~yaml
services:
  homer:
    image: ghcr.io/erathaowl/homer:latest
    ports:
      - "8080:8080"
    volumes:
      - ./assets:/www/assets
    environment:
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      # ADMIN_SECURE_COOKIE: "1"
      # ADMIN_ORIGIN: "https://homer.example.com"
    restart: unless-stopped
~~~

Set ADMIN_PASSWORD in your deployment environment or .env file. Use HTTPS through a trusted reverse proxy for non-local access; set ADMIN_SECURE_COOKIE=1 and ADMIN_ORIGIN to the external origin (scheme, hostname and optional port, without a path). Keep the proxy Host header intact or set ADMIN_ORIGIN. There is no default password. Both variables must be present and nonempty. Sessions expire after eight hours or on server restart. Login attempts are limited per connection address and globally.

The editor reads and writes local .yml files under /www/assets. The volume must be writable by the container user (1000:1000 by default). Source YAML is retained, and visual edits use YAML document nodes rather than replacing the entire configuration with JSON. Alias and merge-key branches require raw YAML editing. Save uses revision checks and atomic replacement. Export your draft before reloading a conflict. The previous five revisions of each page are retained in the hidden .homer-backups directory within the assets volume, excluded from HTTP serving. Recover them directly from the volume. Continue to back up the volume externally.

General, Appearance, Navigation, Groups & cards, Message, Advanced and YAML editor cover the existing configuration schema, including unknown fields. Color pickers, selectors, checkbox groups, searchable Font Awesome suggestions, drag handles, up/down controls and a move-to-group selector are available. The preview is inert and approximate; it does not fetch smart-card APIs or render arbitrary configured HTML. Secondary pages inherit settings at runtime; create links with #page-name. Deleting pages does not update references automatically. External YAML URLs are not written by the server.

**Security:** YAML remains public to dashboard viewers as in upstream Homer. Do not store privileged service credentials in public configuration. Use read-only tokens or a trusted credential-injecting proxy. Never put admin credentials in YAML. Only trusted operators should supply dashboard assets, HTML and styles; dashboard script policy blocks inline scripts. HTML returned by message APIs is limited to safe formatting, images and links; locally configured HTML remains trusted. Do not treat administration as a separate security origin. For untrusted or public dashboards use additional reverse-proxy access restrictions.

## Development

~~~sh
pnpm install --frozen-lockfile
pnpm build
node --test server/*.test.mjs
ADMIN_USERNAME=admin ADMIN_PASSWORD=local-test node server/server.mjs
~~~

Copy public/assets/config.yml.dist to dist/assets/config.yml before starting the local server. Default port 8080. Docker preserves INIT_ASSETS, PORT, SUBFOLDER, IPV6_DISABLE and the existing mount path. Management is disabled without credentials.
