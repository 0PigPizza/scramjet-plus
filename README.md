<p align="center"><img src="https://raw.githubusercontent.com/MercuryWorkshop/scramjet/main/assets/scramjet.png" height="200" alt="Scramjet"></p>

<h1 align="center">Scramjet Plus</h1>

Scramjet Plus is a self-hosted, authenticated web-proxy application built with [Scramjet](https://github.com/MercuryWorkshop/scramjet), Fastify, and Wisp. It adds local account administration, usage limits, individual workspaces, and a persistent data store to the Scramjet demo application.

## Features

- First-run administrator setup and account management
- Per-account request limits and expiry dates
- Persistent account, workspace, bookmark, history, and application data
- WebSocket support through `/wisp/`
- Health endpoint at `/healthz`
- Docker image that runs as an unprivileged user with a persistent volume

## Requirements

- Node.js 20 or newer
- pnpm 10 or newer
- Docker Engine and Docker Compose (recommended for deployment)

## Local development

```sh
pnpm install --frozen-lockfile
pnpm start
```

Open `http://127.0.0.1:8080/admin/setup` to create the initial administrator. The default data location is `data/users.json`; it is intentionally ignored by Git.

Useful checks:

```sh
pnpm lint
pnpm exec prettier --check .
pnpm audit --prod
```

## Docker deployment

Start the application with:

```sh
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:8080/healthz
```

Compose keeps application data in the named `scramjet-data` volume. It publishes the service only on the host loopback interface (`127.0.0.1:8080`), so use a TLS-terminating reverse proxy to expose it publicly. The proxy must forward HTTP WebSocket upgrades for `/wisp/`.

Set `PORT` before starting Compose to choose another local port:

```sh
PORT=8081 docker compose up -d
```

## Configuration

| Variable         | Default              | Purpose                                                                                    |
| ---------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `PORT`           | `8080`               | HTTP listening port.                                                                       |
| `AUTH_DATA_FILE` | `data/users.json`    | Absolute or relative location of the persistent account-data file.                         |
| `NODE_ENV`       | unset                | Set to `production` for deployment.                                                        |
| `COOKIE_SECURE`  | `true` in production | Marks session cookies `Secure`. Keep enabled whenever users access the site through HTTPS. |

## Operations and security

- Back up the `scramjet-data` Docker volume before upgrades or host migrations.
- Keep the origin bound to loopback and expose it only through a hardened HTTPS reverse proxy.
- Do not commit `data/`, environment files, credentials, private keys, or deployment-specific configuration.
- Restrict access to trusted users. Operators are responsible for complying with applicable laws, upstream services’ terms, and hosting-provider policies.

## License

GNU Affero General Public License. See [LICENSE](LICENSE).
