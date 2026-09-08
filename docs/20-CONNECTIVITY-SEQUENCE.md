# Public HTTPS Connectivity Sequence

The gateway, not the VPS, initiates every HTTP connection. The VPS sends commands in responses
to the gateway's poll; the turtle communicates only with the local gateway over Rednet.

Current gateway URL: `https://192-99-69-46.sslip.io:8443`.

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

    G->>T: Rednet command envelope
    T-->>G: Rednet accepted/progress/result event
    G->>I: POST /v1/gateway/events (HTTPS)
    I->>V: Forward authenticated event batch
    V-->>I: Accepted event IDs
    I-->>G: HTTPS acknowledgement

    Note over V,G: The VPS never initiates an unsolicited HTTP request to ComputerCraft.
```

## Boundary summary

- The public boundary is HTTPS port 8443 on the VPS proxy, not the Node.js control-plane port.
- TCP port 8787 is bound only to the private Docker bridge on the VPS.
- The firewall and proxy restrict the public endpoint to `51.161.113.44/32`.
- HTTPS protects the gateway bearer secret in transit; the bearer secret authenticates the
  gateway after network admission.
- The turtle does not access the internet or VPS directly.
