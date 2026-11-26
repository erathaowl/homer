# Administrative configuration editor — implementation plan

## Scope and baseline

Homer is a Vue 3/Vite PWA served by Lighttpd. The dashboard reads `assets/config.yml` at runtime, follows `externalConfig`, applies page-specific YAML by hash, and merges the result with `src/assets/defaults.yml`. There is no write API. The existing `/www/assets` volume is the source of truth. No database or migration of existing YAML is required.

References: [configuration](configuration.md), [theming](theming.md), [smart cards](customservices.md), [development](development.md), [Kubernetes](kubernetes.md), [tips](tips-and-tricks.md), [troubleshooting](troubleshooting.md), [schema](../.schema/config-schema.json), [agent instructions](../AGENTS.md). Use the actual runtime implementation when the schema or docs differ.

## 1. Runtime architecture

- Keep the dashboard and existing Vue components; add a separate, lazily loaded Vue admin application at `admin/` using the existing Bulma, Font Awesome and YAML stack. Use a separate Vite build outside the public dashboard root, relative URLs and no Vue Router unless needed. Keep the static ZIP usable without management.
- Add a small Node.js 24 server using the native HTTP server and the existing YAML package. In the managed Docker image, serve the built dashboard and admin/API from one process; replace Lighttpd rather than supervise two servers. Preserve port, non-root UID/GID, `SUBFOLDER`, `IPV6_DISABLE`, asset initialization, health check, cache headers, custom assets and bind mount behavior. Keep the static-only deployment documented. Explicitly test reverse proxies and subpaths.
- Admin is disabled by default through `ADMIN_ENABLED=0`. Only explicit enablement (`1` or `true`) activates the API and frontend; fail startup for incomplete/empty configured credentials when enabled. All admin routes return 404 when disabled and the admin build is outside the dashboard root and PWA cache. Never embed credentials in Vite variables or generated files. No default password. Admin link is shown only when the server reports management enabled.
- Add `ADMIN_SESSION_TTL` only if a fixed 8-hour session proves insufficient; initially use a fixed TTL. Use HTTPS at the reverse proxy for non-local access.
- Keep the admin API independent of smart card APIs. It must not proxy arbitrary URLs or fetch remote configurations on the server.

## 2. Authentication and security

- Login form, logout, authenticated session status. Compare credential digests in constant time; use cryptographically random session tokens kept in memory with expiration, rotate on login, invalidate on logout/restart. Cookie: HttpOnly, SameSite=Strict, path restricted to the installation's admin prefix, Secure on HTTPS (explicit trusted-proxy configuration if TLS is terminated upstream). Never use localStorage for credentials or tokens.
- Rate-limit login attempts by client and globally; return a generic failure. Limit body size, enforce JSON content type for mutations, verify Origin and session-bound CSRF token, deny CORS, reject unauthenticated API requests. Use no-store for admin responses and exclude admin routes and config drafts from service worker caching.
- Treat dashboard HTML, external message content and arbitrary styles as untrusted across the admin boundary. Sanitize dashboard HTML (preserve documented formatting, images and safe links; strip scripts, event handlers, dangerous URL schemes and active embeds), enforce a suitable CSP on admin, and sandbox previews without same-origin privileges or scripts. Document the compatibility impact and recommend an isolated admin origin when running externally supplied HTML or legacy content. Do not execute user-controlled HTML in the admin DOM.
- Existing Homer deliberately serves YAML to viewers. Admin authentication protects configuration changes, not existing smart-card tokens in public YAML; display this warning beside secret fields and document read-only tokens or a trusted credential-injecting proxy. Never copy admin credentials into YAML.
- Restrict writable files to local configuration pages under the assets directory; reject traversal, symlinks, reserved filenames, arbitrary file paths and unsafe identifiers. Do not expose backups or temporary files through static serving.

## 3. YAML persistence

- Read and write YAML source rather than a fully merged JSON configuration. Use the existing YAML package's document/node API with merge support to preserve comments, anchors, aliases, formatting where possible, unknown keys, custom fields and key order. Preserve scalar types and distinguish missing/inherited, null, false and empty.
- Apply field-level changes to the document; reorder existing YAML nodes rather than rebuilding lists. Test aliases and merge keys explicitly; if a safe visual edit cannot be represented, show a clear warning and require raw editing. Never silently flatten anchors or strip unknown fields. Expose read-only effective defaults separately from explicit overrides.
- Validate YAML syntax, one mapping document, duplicate keys, alias expansion limits and known field types. Reconcile schema with runtime: numeric/string columns, scalar/array stylesheet, null options, optional smart card fields and additional properties. Unknown fields are warnings, not grounds for destructive cleanup. Return field paths and readable errors.
- Use SHA-256 revision of source bytes as optimistic concurrency token. Serialize writes per file; re-read before replacing and return HTTP 409 on conflict. Write a temporary file in the same directory, preserve permissions, fsync and rename atomically. Keep a bounded set of protected backups outside the public directory if the persistent storage is writable; otherwise report that backup storage is unavailable. Never overwrite an invalid file without explicit repair.
- List/edit/create/delete secondary YAML pages with safe slugs and reserved-name checks. Protect config.yml from deletion; confirm and warn about navbar links on page deletion. Handle renames/reference changes as explicit operations, avoid pretending multiple file writes are atomic.
- If externalConfig is configured, show the URL and read-only warning; edit the local pointer or explicitly switch to local YAML. Never overwrite a remote file. Support read-only volumes and externally generated Kubernetes configurations gracefully.

## 4. API contract

All paths below are relative to the installation base; administration endpoints live below `admin/api/`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | status | Enabled/authenticated status; no secret values |
| POST | login | Verify configured credentials, issue session |
| POST | logout | Invalidate session |
| GET | pages | List local configuration documents |
| GET | pages/:slug | YAML source, revision, validation diagnostics |
| PUT | pages/:slug | Validate and atomically save YAML with revision |
| POST | pages | Create a secondary page |
| DELETE | pages/:slug | Delete a secondary page with revision |
| POST | validate | Validate unsaved YAML without persisting |

Use consistent JSON errors (400, 401, 403, 404, 409, 413, 422, 429, 503). Include no secrets in logs. Provide `Cache-Control: no-store` on all API responses.

## 5. Admin experience

Responsive shell with desktop sidebar, mobile navigation, page selector, search within settings and a persistent dirty-state/save bar. Use the existing style system and accessible controls. Separate Save, Discard, Preview, Import and Export; edits are local until Save, with a navigation guard and explicit confirmation for deletion. Offer conflict reload/export rather than silently overwrite. Show inline validation, keyboard navigation, focus management and touch-friendly targets.

| Section | Controls and behavior |
| --- | --- |
| General | Title, subtitle, browser title, logo URL/path preview, Font Awesome searchable icon picker, header/footer toggles and HTML source, search hotkey capture, connectivity toggle, refresh interval with disabled/inherited and time-unit choices |
| Appearance | Theme tiles for default, neon and walkxcode, light/dark/auto selector, columns/list segmented control, columns 1/2/3/4/6/12/auto, icon width, light/dark palette tabs, HEX/RGB(A)/CSS-value editing with native color picker and unset/reset, background image preview, card shadow, all status and badge colors, editable ordered stylesheets |
| Navigation | Add/edit/duplicate/delete/reorder links, page selection for hash links, icon picker, URL and target selector with custom value fallback |
| Pages | List, add, duplicate and delete secondary pages; show which values inherit the main config; switch between effective and overridden values |
| Groups and cards | Expandable groups, card search, add/duplicate/remove groups and cards, reorder groups/cards and move cards between groups with drag handles; keyboard and touch reordering plus move-to-group alternative |
| Card editor | Basic and smart-card type selector, name, subtitle, logo/icon, URL, target, tag and Bulma style multi-selection, keywords, CSS class and background, ordered quick links with icons/colors |
| Smart cards | Dynamic type-specific fields, common endpoint, headers key/value rows, inherited/true/false credentials, status code multi-select, refresh options, badge hide multi-select; advanced YAML for unknown fields |
| Message | Enable/disable, style selector, title/icon, HTML source, API URL, mapping key/value rows and refresh interval |
| Advanced | Proxy credentials/headers, custom keys, external config pointer, complete raw YAML editor with diagnostics and import/export |

Use the installed Font Awesome metadata to generate a searchable icon catalog during build; do not make a remote dependency. Use native color inputs with a companion text field (CSS values such as rgba or variables must survive). Use SortableJS only if native controls cannot provide reliable cross-group touch dragging; add keyboard move controls regardless. Avoid a second CSS framework or custom component library. Preview unsaved config without network polling or real credentialed smart-card calls; reuse card/theme presentation with inert sample data. Preview both color modes and responsive widths, then reload the public dashboard after saving.

## 6. Smart-card coverage

Generate the available type list from actual service component filenames (exclude internal components); maintain one compact metadata registry for type-specific options, choices, required fields and badge keys. Use the documented examples and implementation together. The schema deliberately permits extra item fields; preserve them even when a card type is unknown. A generic YAML section must cover all unknown/custom options from day one.

Coverage includes all documented integrations: AdGuardHome, Authelia, Beszel, CopyToClipboard, DockerSocketProxy, Docuseal, Emby/Jellyfin, FreshRSS, Gatus, Gitea/Forgejo, Glances, Gotify, Healthchecks, HomeAssistant, HyperHDR, Immich, Jellystat, Lidarr, Prowlarr, Sonarr, Readarr, Radarr, Linkding, LibrisLog, Matrix, Mealie, Medusa, Memos, Mylar, Miniflux, NetAlertx, Nextcloud, OctoPrint/Moonraker, Olivetin, OpenHAB, OpenWeather, PaperlessNG, PeaNUT, PiAlert, PiHole, Ping, Plex, Portainer, Prometheus, Proxmox, qBittorrent, Rtorrent, SABnzbd, Scrutiny, Seerr, SpeedtestTracker, Tautulli, Tdarr, Traefik, Transmission, TruenasScale, UptimeKuma, Vaultwarden, Wallabag and WUD. Include ThemeChooser and Generic where supported by source. Verify aliases use the correct component type.

Examples: PiHole API version 5/6; Ping HEAD/GET, status codes and timeout; Emby library type and legacy auth; OpenWeather units and location; Glances stats multi-select; Proxmox thresholds and hide flags; UptimeKuma slug; Gatus groups; Portainer environments; Linkding limits; OctoPrint display mode; Traefik badge keys. Mask token/password fields visually and warn that public YAML remains readable.

## 7. Implementation order and acceptance criteria

1. **Foundation:** capture representative YAML fixtures (comments, anchors, secondary pages, unknown fields, custom services, malformed YAML); align schema with real behavior. Build and test the document editing and persistence functions before UI work.
2. **Server:** add runtime serving, authentication, sessions, CSRF, validation, page API, atomic writes and concurrency checks. Keep default read-only behavior and static deployment intact.
3. **Admin shell:** login/logout, navigation, page selector, raw editor, dirty-state handling, import/export and accessible save/error feedback.
4. **Visual editors:** general, appearance, navigation, groups/cards, nested quick links, drag-and-drop and keyboard alternatives; integrate document node operations.
5. **Smart cards and preview:** full metadata registry, dynamic fields, custom options, preview sandbox, light/dark and mobile modes.
6. **Hardening and deployment:** ensure no credential leakage, cache isolation, safe URL/HTML handling, read-only and non-root container behavior, reverse-proxy and Kubernetes docs. Update README and AGENTS.md to reflect managed vs static deployments.

## 8. Verification

- Unit tests using Node's test runner for credential comparison, session lifecycle, YAML mutation, type preservation, alias safety, revision conflict, malformed files, atomic writes, safe paths and registry coverage.
- API integration tests using temporary directories: disabled admin, unauthorized read/write, invalid login, CSRF/Origin rejection, successful CRUD, conflicting edits, read-only permissions, malformed YAML, traversal/symlinks, no public backups or admin secrets.
- Browser tests (Playwright): login, edit a title, theme/colors, create and move cards across groups (mouse/touch/keyboard), smart card settings, secondary page, save/reload, discard, conflicts and validation. Verify HTML safety, mobile layouts and service worker isolation.
- Run lint without auto-fixing in CI, production build, unit/API/browser tests and container smoke tests. Verify fresh install, existing mounted assets, custom UID, custom PORT, SUBFOLDER, IPv6 disable, disabled admin and authenticated persistent editing after restart.
- Acceptance: existing valid config loads unchanged; saving one field does not alter unrelated fields; all documented common and service-specific options are editable; no unauthenticated mutation succeeds; configuration survives container restart; static ZIP and public dashboard continue working.

## 9. Release and deployment

The fork publishes to `ghcr.io/erathaowl/homer`. Validate and build on pull requests and main pushes; publish only from valid version tags. Normalize `vX.Y` to `vX.Y.0`, retain the original tag as a Docker alias when different, and create the release under the normalized Git tag. Build amd64/arm64 and preserve existing ARM variants where supported. Release the static ZIP only after successful image publishing. Update the displayed build version from the normalized tag. See [README](../README.md) for the current pipeline.

When management is implemented, document a Compose example with `ADMIN_ENABLED`, `ADMIN_USERNAME` and `ADMIN_PASSWORD` and a writable assets volume. No release should be marked as containing the editor before the above acceptance criteria are met.
