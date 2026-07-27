# m5 Native Dual Rusty Crew And Rusty View Deployment

This deployment runs two isolated Rusty Crew fleets on the nephew-agentbox
machine while reusing one den-services installation.

For the beginner-oriented shareable explanation and normal usage guide, see
[m5-basic-user-guide.md](m5-basic-user-guide.md).

Each Crew process is a host-native systemd service running as Unix user `jb`.
Both services use one exact-version staged release containing Rusty Crew, Rusty
View, and the pinned Node runtime. The browser and its Crew API therefore share
an origin:

| Instance | LAN URL                     | Runtime root                             | SQLite database                    |
| -------- | --------------------------- | ---------------------------------------- | ---------------------------------- |
| A        | `http://192.168.1.10:9347/` | `/data/services/rusty-stack/instances/a` | `data/engine/coordination.sqlite3` |
| B        | `http://192.168.1.10:9348/` | `/data/services/rusty-stack/instances/b` | `data/engine/coordination.sqlite3` |

The roots, configuration, workspaces, artifacts, and SQLite files are not
shared. A single den-services install is correct because Den owns common
planning/product data while each Crew process owns its own coordination and
agent data.

The services are deliberately host-native. Agent tools execute as `jb` in the
host mount/process namespace and can use the host filesystem, Git/SSH state,
installed tools, Docker-group access, and passwordless sudo available to that
account. `RUSTY_CREW_DEFAULT_WORKDIR` starts each instance in its own workspace
but is not a sandbox boundary.

## Bootstrap

The host needs Git, Docker, curl, jq, systemd, and passwordless permission to
operate Docker and install system units. Docker is used only as a reproducible
build environment. The long-running Crew processes are not containers. The
paired build extracts its pinned Node runtime, so the host does not need a Node
or Rust upgrade.

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

The first run clones Rusty Crew, fast-forwards both repositories, builds and
extracts a paired release, creates both runtime roots, installs
`rusty-crew-m5@a.service` and `rusty-crew-m5@b.service`, starts both instances,
and writes `/data/services/rusty-stack/deployed-revisions.json`.

Both instances deliberately start with an empty runtime graph and tokenless
admin access on the trusted experiment LAN. Profiles, providers, sessions, and
MCP tool bindings still need to be created through Rusty View or the official
Crew APIs.

## Shared Den MCP

Both service environments contain:

```dotenv
RUSTY_CREW_MCP_BASE_URL=http://127.0.0.1:5199/mcp
```

The updater proves that the host can reach the local den-services health
endpoint and that both instance configs carry this exact MCP base URL. That is
a network/configuration proof, not a claim that an empty Crew profile already
has Den tools. Tool selection and profile binding remain normal Crew setup.

## Updating

The normal update is one command:

```bash
sudo update-rusty-stack
```

It refuses tracked or untracked source changes, fetches and fast-forwards both
repositories, builds one staged release labelled with both exact SHAs, then
atomically switches the `current` symlink and restarts/verifies both instances.
Existing SQLite data and configuration stay in the instance roots.

Activation is paired. If replacement or verification fails, the updater
restores the previous native release. During the initial Docker-to-systemd
migration it leaves the stopped legacy containers and their original
`config/service.env` and `config/service.json` intact. Native systemd uses a
separate `native-config` directory while sharing the existing profiles, skills,
secrets, and data. The updater can therefore restart the old containers if
native activation fails instead of merely preserving unusable container
metadata.

Check only the source safeguards with:

```bash
sudo update-rusty-stack --check-sources
```

The updater detects a no-change exact revision, restarts and verifies the
current native release, and avoids rebuilding it.

## Operations And Recovery

```bash
sudo systemctl status rusty-crew-m5@a.service
sudo systemctl status rusty-crew-m5@b.service
sudo systemctl restart rusty-crew-m5@a.service rusty-crew-m5@b.service
sudo journalctl -u rusty-crew-m5@a.service -n 200
sudo journalctl -u rusty-crew-m5@b.service -n 200
sudo update-rusty-stack --verify
```

Both systemd units are enabled at boot.
Back up each SQLite database independently with the Rusty Crew online SQLite
backup helper or while its owning service is stopped; copying only the main
file while WAL is active is not a valid backup.

If an update must be rolled back manually, select a prior directory under
`/data/services/rusty-stack/releases`, repoint
`/data/services/rusty-stack/current` atomically, and restart both units. Do not
point both instances at the same runtime root or database.

During the first migration, the old `rusty-crew-a` and `rusty-crew-b`
containers remain stopped as a rollback boundary. After native restart and host
reboot acceptance, retire only those containers:

```bash
sudo update-rusty-stack --retire-docker
```

This preserves their images and all instance data and writes
`/data/services/rusty-stack/docker-retired.json`.
