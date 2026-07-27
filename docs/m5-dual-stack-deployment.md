# m5 Dual Rusty Crew And Rusty View Deployment

This deployment runs two isolated Rusty Crew fleets on the nephew-agentbox
machine while reusing one den-services installation.

For the beginner-oriented shareable explanation and normal usage guide, see
[m5-basic-user-guide.md](m5-basic-user-guide.md).

Each Crew process serves the Rusty View build embedded in the same exact-version
container image. The browser and its Crew API therefore share an origin:

| Instance | LAN URL | Runtime root | SQLite database |
| --- | --- | --- | --- |
| A | `http://192.168.1.10:9347/` | `/data/services/rusty-stack/instances/a` | `data/engine/coordination.sqlite3` |
| B | `http://192.168.1.10:9348/` | `/data/services/rusty-stack/instances/b` | `data/engine/coordination.sqlite3` |

The roots, configuration, workspaces, artifacts, and SQLite files are not
shared. A single den-services install is correct because Den owns common
planning/product data while each Crew process owns its own coordination and
agent data.

## Bootstrap

The host needs Git, Docker with Compose, curl, and passwordless permission to
operate Docker. It does not need a host Node or Rust upgrade; the paired image
build pins those toolchains.

Install the updater and run it:

```bash
sudo install -d /data/services/rusty-stack/repos
sudo chown -R "$(id -u):$(id -g)" /data/services/rusty-stack
git clone https://github.com/FuzzySlipper/rusty-view.git \
  /data/services/rusty-stack/repos/rusty-view
sudo ln -sfn \
  /data/services/rusty-stack/repos/rusty-view/scripts/update-m5-dual-stack.sh \
  /usr/local/sbin/update-rusty-stack
sudo update-rusty-stack
```

The first run clones Rusty Crew, fast-forwards both repositories, builds a
paired image, creates both runtime roots, starts both instances, and writes
`/data/services/rusty-stack/deployed-revisions.json`.

Both instances deliberately start with an empty runtime graph and tokenless
admin access on the trusted experiment LAN. Profiles, providers, sessions, and
MCP tool bindings still need to be created through Rusty View or the official
Crew APIs.

## Shared Den MCP

Both service environments contain:

```dotenv
RUSTY_CREW_MCP_BASE_URL=http://host.docker.internal:5199/mcp
```

Compose maps `host.docker.internal` to Docker's host gateway. The updater proves
that each container can reach the host den-services health endpoint. That is a
network/configuration proof, not a claim that an empty Crew profile already has
Den tools. Tool selection and profile binding remain normal Crew setup.

## Updating

The normal update is one command:

```bash
sudo update-rusty-stack
```

It refuses tracked or untracked source changes, fetches and fast-forwards both
repositories, builds one image labelled with both exact SHAs, then replaces and
verifies both instances. Existing SQLite data and configuration stay in the
bind-mounted instance roots.

Activation is paired. If replacement or verification fails after a previous
deployment exists, the updater restores the previous stack environment and
reactivates the prior image.

Check only the source safeguards with:

```bash
sudo update-rusty-stack --check-sources
```

## Operations And Recovery

```bash
cd /data/services/rusty-stack
sudo docker compose \
  --env-file stack.env \
  --file repos/rusty-view/docker/m5/compose.yaml \
  ps

sudo docker restart rusty-crew-a rusty-crew-b
sudo docker logs --tail 200 rusty-crew-a
sudo docker logs --tail 200 rusty-crew-b
```

Docker is enabled at boot and both containers use `restart: unless-stopped`.
Back up each SQLite database independently with the Rusty Crew online SQLite
backup helper or while its owning service is stopped; copying only the main
file while WAL is active is not a valid backup.

If an update must be rolled back manually, select the prior paired image from
`docker image ls rusty-crew-view`, replace `RUSTY_STACK_IMAGE` and both revision
values in `stack.env`, then run the Compose `up --detach --wait` command above.
Do not point both instances at the same runtime root or database.
