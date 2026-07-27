# Den And Rusty Crew: Basic User Guide

This is a beginner-oriented guide to the Den and Rusty Crew installation on the
`m5` agent experiment machine. It explains what the pieces are, which address
to use, and the normal shape of day-to-day use.

The system is still evolving. Some labels and settings may move between
updates, so initial provider, profile, and tool setup is best done together
with the person maintaining the machine.

## Addresses

Open these addresses from a computer on the same LAN:

| Service      | Address                     | Purpose                                                             |
| ------------ | --------------------------- | ------------------------------------------------------------------- |
| Den Web      | `http://192.168.1.10:18080` | Shared projects, tasks, documents, messages, and reference material |
| Rusty View A | `http://192.168.1.10:9347`  | First independent Rusty Crew workspace                              |
| Rusty View B | `http://192.168.1.10:9348`  | Second independent Rusty Crew workspace                             |

Choose one Rusty View address for each person and keep using that address. The
two Crew workspaces have separate configuration, conversations, artifacts, and
SQLite databases.

Both people use the same Den Web address. Den is intentionally shared.

These services are configured for a trusted local network and currently do not
have a normal user login screen. Anyone who can reach these addresses on the
LAN may be able to use them. Do not expose these ports directly to the public
Internet.

## The Short Explanation

It helps to think of the system as three pieces:

- **Den Services** is the shared planning and reference system. It stores
  projects, tasks, documents, messages, review history, and related durable
  information.
- **Rusty Crew** is the backend that runs and coordinates AI agents. It owns
  agent profiles, model-provider settings, conversations, tool activity, and
  other Crew-local state.
- **Rusty View** is the web interface for one Rusty Crew backend. It is where
  you configure profiles, start conversations, send prompts, and inspect what
  an agent did.

Rusty View and Rusty Crew are deployed together at each of the two Rusty View
addresses. You do not normally open Rusty Crew separately.

```text
                    shared planning and reference data
                 +--------------------------------------+
                 | Den Web / Den Services               |
                 | http://192.168.1.10:18080            |
                 +------------------+-------------------+
                                    |
                           Den MCP tools, when bound
                                    |
              +---------------------+---------------------+
              |                                           |
+-------------+--------------+              +-------------+--------------+
| Rusty View + Crew A        |              | Rusty View + Crew B        |
| http://192.168.1.10:9347   |              | http://192.168.1.10:9348   |
| own config, chats, SQLite  |              | own config, chats, SQLite  |
+----------------------------+              +----------------------------+
```

This is a practical substitute for multi-user support. It is isolation between
two Crew installations, not an account or permissions system. Someone can
still open the other address if they know it.

## What Is Shared And What Is Separate?

| Information                        | Shared?    | Where it lives               |
| ---------------------------------- | ---------- | ---------------------------- |
| Den projects and tasks             | Yes        | Den Services                 |
| Den documents and project messages | Yes        | Den Services                 |
| Agent profiles and model settings  | No         | The selected Crew instance   |
| Conversation history               | No         | The selected Crew instance   |
| Crew artifacts and tool history    | No         | The selected Crew instance   |
| Crew SQLite database               | No         | The selected Crew instance   |
| Browser appearance preferences     | Usually no | That browser's local storage |

If both people work in the same Den project, both can see its tasks and
documents. Their Rusty Crew conversations remain separate as long as each
person consistently uses their assigned Rusty View address.

## First-Time Rusty View Setup

The two Crew installations start mostly empty. Before an agent can answer
normally, each Crew instance needs at least a model provider and a usable
profile. The exact fields depend on the provider and may change as Rusty Crew
evolves.

Use this general order:

1. Open your assigned Rusty View address.
2. Open the administration or settings area.
3. Add or configure a model provider.
4. Enter credentials through the provider credential controls. Do not paste API
   keys into an ordinary chat or a Den document.
5. Create a profile and select its provider and model.
6. Configure its instructions, reasoning level, and local tools as needed.
7. If the profile should use Den, add or select the Den MCP server and bind the
   desired Den tools to the profile.
8. Create a conversation for the profile and send a small test message.
9. If Den tools were enabled, ask the agent to list Den projects or read a
   harmless known task as a connectivity test.

The machine-level Den connection is already configured at:

```text
http://127.0.0.1:5199/mcp
```

That address is correct because both Crew services now run directly on the
host.

The installed connection only proves Crew can reach Den Services. It does not
automatically add every Den tool to every profile. Provider credentials,
profiles, tool selections, and MCP bindings are deliberately configured per
Crew instance.

## Basic Rusty View Use

Rusty View has two related concepts:

- **Profiles** are normal Crew-managed chat identities. A profile combines
  instructions, model/provider choices, tools, and one or more durable
  conversations.
- **Agents** are external runtime sessions managed through Crew, such as an
  attached Codex runtime. These require additional runtime setup and may be
  empty on a new installation.

For an ordinary first session, start with a profile:

1. Select the profile.
2. Create or select a conversation.
3. Type a clear request in the composer and send it.
4. Watch the response stream into the transcript.
5. Expand reasoning, tool, command, or diagnostic blocks when you need to
   understand what happened.
6. Continue in the same conversation when the new request depends on earlier
   context. Start a new conversation when it does not.

A useful first prompt is deliberately small:

```text
Briefly explain which tools you have available. Do not change anything.
```

If Den tools are bound, a useful read-only follow-up is:

```text
List the Den projects you can currently see. Do not modify Den.
```

Agent output can be wrong. Inspect tool calls and resulting files or task state
before treating a claim as completed work, especially when the request changes
code, services, or shared Den data.

## Basic Den Web Use

Den is the shared cockpit. The major areas are:

- **Projects** organize related work and reference material.
- **Tasks** describe work, status, dependencies, review, and completion
  evidence.
- **Documents** hold longer-lived specifications, guides, decisions, and
  reference material.
- **Messages** hold project and task-thread discussion and handoffs.
- **Notifications** show noteworthy updates that may need attention.
- **Librarian** searches and summarizes relevant Den information with source
  references.
- **Timeline/Conversation** shows project activity and supports shared project
  discussion.

A basic task workflow is:

1. Select the correct project.
2. Open its task list.
3. Read the task description, dependencies, recent messages, and review state.
4. Move work through the normal states as it progresses:

   ```text
   planned -> in_progress -> review -> done
   ```

5. Put important evidence in the task thread: what changed, the exact revision
   when code is involved, checks performed, deployment state, and remaining
   limitations.
6. Use documents for durable knowledge that should remain useful beyond one
   task.

Den task state is shared. Avoid experimenting with status changes on a real
task unless you understand what the change means. If you only want to learn the
interface, create a clearly named test project or test task.

## Using Den From A Crew Agent

When a Crew profile has Den MCP tools bound, the agent can work with Den
directly. Examples include reading task context, searching documents, posting
task evidence, or updating task state.

Good requests identify the exact task and the desired authority:

```text
Read Den task 1234 and summarize its current status. Do not modify anything.
```

```text
Work on Den task 1234. Read its task context first, make the requested change,
verify it, and record the implementation evidence in its task thread.
```

Start with read-only requests until the profile's tool configuration is known
to work. A model having a Den tool does not guarantee that it will use the tool
correctly, so check the visible task or document afterward.

Den and Crew have different responsibilities:

- Den owns the shared task, project, document, and planning records.
- Crew owns agent coordination, profiles, transcripts, provider state, and
  Crew-local data.

The Den connection does not merge the two Crew databases and does not make
their conversation histories shared.

## Common Points Of Confusion

### The two Rusty View pages look identical

That is expected on a new installation. Check the port in the browser address:
`9347` and `9348` are different Crew backends even when their empty screens
look the same.

### An agent can chat but cannot use Den

The model provider and profile may be working while the Den MCP tools are not
bound to that profile. Check the profile's MCP/tool configuration.

### Rusty View says no provider, profile, or session exists

The Crew instance is empty or only partly configured. Complete the first-time
setup with the maintainer.

### One person cannot see the other person's Crew conversation

That is intentional. Their conversations are in separate Crew installations.
Use Den messages or documents for information that should be shared.

### Both people can see the same Den task

That is also intentional. There is one shared Den Services installation.

### A page stops updating

Refresh the browser once. If the problem remains, note which URL, page,
profile, and conversation were open, plus roughly when it happened. Avoid
repeatedly clicking destructive or retry controls while the service state is
unclear.

### A service cannot be reached

Confirm the computer is on the same LAN and use `http`, not `https`. Record the
exact address and browser error for the maintainer.

## Maintenance Notes

Ordinary users should not need server access. The maintainer can update both
Crew/View installations together on `m5` with:

```bash
sudo update-rusty-stack
```

The updater fetches current Rusty Crew and Rusty View revisions, builds one
paired release, updates both native systemd services, verifies them, and records
the exact deployed revisions. It preserves the two instance data directories.

The agent processes run as the host user `jb`. Their default workspaces are
separate, but they can deliberately access the broader host filesystem and
tools when their profile exposes the corresponding capabilities. This is
intentional for the agent experiment machine and is not a security sandbox.

Do not manually point both Crew services at the same directory or SQLite
database. Backups and deeper recovery should follow the separate
`m5-dual-stack-deployment.md` operator guide.

## Quick Reference

```text
Shared Den:
  http://192.168.1.10:18080

Crew/View A:
  http://192.168.1.10:9347

Crew/View B:
  http://192.168.1.10:9348

Rule of thumb:
  Shared knowledge and work records go in Den.
  Private agent configuration and conversations stay in your Crew instance.
```
