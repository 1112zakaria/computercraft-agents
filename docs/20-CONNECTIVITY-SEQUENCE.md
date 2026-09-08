# Public HTTPS Connectivity Sequence

The ComputerCraft client, not the VPS, initiates every HTTP connection. Gateway-backed turtles
communicate with their local gateway over Rednet; direct turtles communicate with the VPS over
the dedicated worker API.

Current gateway URL: `https://192.99.69.46.sslip.io:8443`.

```mermaid
sequenceDiagram
    autonumber
    participant O as Operator CLI
    participant V as VPS Control Plane
    participant I as VPS HTTPS Ingress<br/>(firewall + Caddy)
    participant G as ComputerCraft Gateway
    participant T as Turtle

    Note over I,G: HTTPS ingress accepts only source 51.161.113.44/32.<br/>Gateway ID and bearer secret are also required.

    O->>V: Queue bounded command for worker
    G->>I: POST /v1/gateway/register (HTTPS)
    I->>I: Verify source IP and path
    I->>V: Forward to 127.0.0.1:8787
    V-->>I: Registration response
    I-->>G: HTTPS response

    loop Heartbeat and command polling
        G->>I: POST heartbeat / GET commands (HTTPS)
        I->>I: Verify source IP, path, TLS
        I->>V: Forward authenticated request
        V-->>I: Heartbeat acknowledgement / commands
        I-->>G: HTTPS response
    end

    O->>V: POST /v1/updates (admin CLI)
    V->>V: Persist QUEUED rollout and reject overlap
    G->>I: GET commands poll (HTTPS)
    I->>V: Forward authenticated poll
    V-->>I: Update control with immutable manifest URL
    I-->>G: HTTPS response
    G->>G: Download GitHub manifest/runtime files over HTTPS
    G->>T: worker.update.prepare
    T-->>G: worker.update.ack PREPARED
    loop Bounded runtime file transfer
        G->>T: begin/chunk/end with update ID and chunk numbers
        T-->>G: worker.update.ack
    end
    G->>T: worker.update.activate
    T-->>G: worker.update.ack ACTIVATED
    T->>T: Preserve config/state, activate, reboot, register new version
    T->>G: worker.update.activated event
    G->>I: POST /v1/gateway/events (HTTPS)
    I->>V: Persist update status and event history
    V-->>O: update-status reports success or rollback

    G->>T: Rednet command envelope
    T-->>G: Rednet accepted/progress/result event
    G->>I: POST /v1/gateway/events (HTTPS)
    I->>V: Forward authenticated event batch
    V-->>I: Accepted event IDs
    I-->>G: HTTPS acknowledgement

    Note over V,G: The VPS never initiates an unsolicited HTTP request to ComputerCraft.
```

## Direct turtle transport

```mermaid
sequenceDiagram
    autonumber
    participant O as Operator CLI
    participant V as VPS Control Plane
    participant I as VPS HTTPS Ingress<br/>(firewall + Caddy)
    participant T as Direct Turtle

    Note over I,T: HTTPS ingress accepts only source 51.161.113.44/32.<br/>Worker ID and shared bearer secret are also required.

    T->>I: POST /v1/worker/register (HTTPS)
    I->>I: Verify source IP, TLS, bearer, worker header
    I->>V: Forward authenticated worker request
    V-->>I: Registration response
    I-->>T: HTTPS response

    loop Fixed bounded polling
        T->>I: POST heartbeat / GET commands?after=cursor
        I->>V: Forward authenticated worker request
        V-->>I: commands, stopControls, updates, nextCursor
        I-->>T: HTTPS response
        T->>T: Execute one bounded command or stage update
        T->>I: POST /v1/worker/events (durable outbox)
        I->>V: Deduplicate event IDs and persist observations
        V-->>T: acceptedEventIds
    end

    O->>V: update --target worker:alice --version v0.4.0
    V->>V: Persist direct rollout and reject overlap
    T->>I: GET /v1/worker/commands?after=cursor
    V-->>T: Direct update control with immutable GitHub manifest URL
    T->>T: Download manifest/files from GitHub
    T->>T: Stop, stage, preserve config/state, activate, reboot
    T->>I: POST /v1/worker/events (activated or rolled_back)
    V-->>O: update-status reports result

    Note over V,T: The VPS never opens an inbound connection to the turtle.<br/>No gateway computer or modem is required.
```

## Boundary summary

- The public boundary is HTTPS port 8443 on the VPS proxy, not the Node.js control-plane port.
- TCP port 8787 is bound only to the private Docker bridge on the VPS.
- The firewall and proxy restrict the public endpoint to `51.161.113.44/32`.
- HTTPS protects the gateway bearer secret in transit; the bearer secret authenticates the
  gateway after network admission.
- A gateway-backed turtle does not access the internet or VPS directly; it uses local Rednet.
- A direct turtle does access the same public HTTPS VPS endpoint directly and therefore needs the
  ComputerCraft HTTP allowlist, but no modem.
