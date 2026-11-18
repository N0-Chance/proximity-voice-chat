# My relay (TURN) server

**This is not a guide to setting up coturn, or a relay server in general.** It's a record of what *I* did, and what I *had to* do, to get proximity voice chat working with this module for my own table. Your hosting, network, firewall and coturn version will differ. Treat everything here as one working example, check [coturn's documentation](https://deepwiki.com/coturn/coturn) for your version, and adapt.

The setup: one self-hosted coturn server, audio-only voice chat, a table of about 7 players, everyone connecting from home over the internet. It went live in November 2026, and its capacity was fixed after the first game day gotcha (see [The first game day](#the-first-game-day)).

Honestly, I had fun putting it together, and think it is an excellent edition to my home-lab stack and collection. 

Placeholders used throughout:
- `turn.example.com` and `example.com`: the relay's public name and its realm.
- `<PUBLIC_IP>`: the relay's public address.
- `<PRIVATE_IP>`: the relay host's private address.
- `<USERNAME>` and `<PASSWORD>`: the TURN credentials.

---

## Contents
1. [Why I needed a relay](#why-i-needed-a-relay)
2. [What I ran](#what-i-ran)
3. [Design decisions](#design-decisions)
4. [Installing and configuring coturn](#installing-and-configuring-coturn)
5. [Keeping external-ip current](#keeping-external-ip-current)
6. [Monitoring](#monitoring)
7. [Firewall and NAT](#firewall-and-nat)
8. [DNS](#dns)
9. [Foundry and the module](#foundry-and-the-module)
10. [Testing](#testing)
11. [The first game day](#the-first-game-day)
12. [Left for later](#left-for-later)
13. [Command reference](#command-reference)

---

## Why I needed a relay

Foundry's voice chat is peer-to-peer WebRTC: every pair of players connects browser to browser. Everyone is behind a NAT that drops unsolicited incoming packets, so the browsers' ICE process tries three routes, in order:
1. A host or LAN address.
2. A public address discovered via STUN, with simultaneous hole punching.
3. A relay, via TURN.

Route 2 fails when either side has endpoint-dependent ("symmetric") NAT, carrier-grade NAT, or a firewall that blocks UDP. **Foundry ships no relay**, so those pairs simply got silence, and the console showed `ICE failed, add a TURN server`.

I didn't need a separate STUN server. coturn answers STUN on 3478, and Foundry only accepts one relay URL anyway: setting a custom relay replaces the browser's default STUN servers.

---

## What I ran

| Item | Value |
|---|---|
| Software | coturn 4.6.1, the Debian 13 package, running as the `turnserver` user |
| Host | A small Linux container (LXC) on my hypervisor, on an isolated network segment for internet-facing services |
| Resources | 1 core, 1 GB RAM, 8 GB disk. Actual traffic is about 8 KB/s per relayed audio stream. |
| Public name | `turn.example.com`, an A record that's DNS-only (not proxied), with a 1-minute TTL |
| Relay URL in Foundry | `turn:turn.example.com:3478` (UDP) |
| Ports | 3478 over UDP and TCP (listener), and **49160–49459 over UDP** (relay range, 300 ports) |
| Capacity | About 300 concurrent relay allocations. Ports, quotas and bandwidth reservation are all sized to agree (see [Capacity](#capacity-how-the-three-limits-interact)). |
| Credential | One static user, **treated as public**, because Foundry sends it to every player's browser |
| Monitoring | A local STUN self-check feeding an external "dead man's switch" service (see [Monitoring](#monitoring)) |

---

## Design decisions

**Placement: an isolated network segment.** The credentials are effectively public, so the people who can use the relay are, in principle, anyone. I put it on a segment walled off from my other machines, with the hypervisor itself also isolated. A compromise of the relay then lands somewhere that can't reach anything that matters. Clients only ever talk to the relay's public address, so nothing else needs internal access to it.

**A native package in a container, not Docker.** The distribution package is covered by automatic security updates. That matters: coturn is a C program that parses untrusted packets from the internet, and it has a history of CVEs. Advice like Docker's `network_mode: host` only exists to work around Docker's slow handling of large published port ranges.

**Port 3478.** It's TURN's IANA-assigned port, and some restrictive networks allow it specifically.

I needed no split DNS or hairpin path for the relay's name. If you run the relay on the same network that someone connects to Foundry from, you may need one or both.

---

## Installing and configuring coturn

```bash
apt install -y coturn && systemctl stop coturn && systemctl disable coturn   # stop it at once; see below
cp -a /etc/turnserver.conf /etc/turnserver.conf.dist                         # keep the stock config for reference
turnadmin -k -u <USERNAME> -r example.com -p '<PASSWORD>'                    # prints a 0x… key for the config
truncate -s 0 /etc/turnserver.conf                                           # empty it in place, keeping root:turnserver 640
```

**The stock Debian config is an open relay.** It defines no `lt-cred-mech` and no users, and coturn's documented default in that case is no authentication at all. The service started automatically on install and ran unauthenticated. That was harmless for me only because nothing was forwarded to it yet. My rule: **nothing runs half-configured.**

**Check option names against your version.** I checked every option below against the `turnserver.conf` shipped with 4.6.1 and against `turnserver -h` from the binary itself. coturn's upstream documentation describes 4.7 and later, where some options were renamed or removed. For example, `no-loopback-peers` became `allow-loopback-peers`, and loopback is denied by default.

### My `/etc/turnserver.conf` (anonymised)

```ini
# --- Where it listens and relays ---
listening-ip=<PRIVATE_IP>
relay-ip=<PRIVATE_IP>
listening-port=3478
external-ip=<PUBLIC_IP>/<PRIVATE_IP>    # kept current by a script, see "Keeping external-ip current"
min-port=49160
max-port=49459                          # MUST match the firewall's relay port forward

# --- Authentication ---
lt-cred-mech
realm=example.com
user=<USERNAME>:0x<KEY>
fingerprint

# --- Turn off what I don't use ---
no-tls
no-dtls
no-tcp-relay
no-cli
no-software-attribute
no-multicast-peers

# --- Amplification hardening (Debian's defaults, kept) ---
no-rfc5780
no-stun-backward-compatibility
response-origin-only-with-rfc5780

# --- Capacity (one shared username, so user-quota is effectively the total) ---
total-quota=300
user-quota=300
max-bps=32000
bps-capacity=12000000                   # reservation pool: 12,000,000 / 32,000 = 375 sessions

# --- Peer restrictions: never relay into private or special-use ranges ---
allowed-peer-ip=<PRIVATE_IP>
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.0.2.0-192.0.2.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=198.51.100.0-198.51.100.255
denied-peer-ip=203.0.113.0-203.0.113.255
denied-peer-ip=240.0.0.0-255.255.255.255
denied-peer-ip=::1
denied-peer-ip=::ffff:0.0.0.0-::ffff:255.255.255.255

# --- Logging ---
syslog
no-stdout-log
```

### Why each part is there

- **`listening-ip` and `relay-ip` are fixed.** Left unset, coturn listens on every address, including loopback and IPv6.
- **`external-ip`.** In 4.6.1 this must be a literal IP, not a hostname, hence the update script. coturn's documentation says NAT must map relay ports one to one (external port 12345 = internal port 12345). That's the reason for the [static-port outbound NAT rule](#outbound-nat-static-port).
- **Credentials.** The `0x` key is derived from user, realm and password, so fix the realm *before* generating it. For this server the key is as good as the password; hashing only stops the plaintext being reused elsewhere.
- **`no-tls`, `no-dtls`:** I deferred encrypted relaying (TURNS). Without these lines, coturn tries to start 5349 with no certificate.
- **`no-tcp-relay`:** WebRTC only needs UDP relays. TCP as a *client* transport on 3478 is a separate thing and still works.
- **`no-cli`:** coturn's admin CLI is **on by default with an empty password**.
- **Amplification hardening.** STUN is UDP with no handshake, so requests with forged source addresses can turn a server into a reflector for attacks. These three lines shrink its responses. Keep them: 3478 is open to the whole internet.
- **The deny list is the security boundary.** The credentials are public, so this is what stops anyone from aiming the relay at your LAN.
  - **Use ranges, not CIDR.** `--denied-peer-ip=<ip[-ip]>` is the documented form, per `turnserver -h`. CIDR isn't documented, and a line that fails to parse would be a silent hole.
  - It includes 0.0.0.0/8, closing the bypass in CVE-2020-26262, and the IPv4-mapped IPv6 form.
  - Firewalling the network segment is my second layer, in case the list ever has a typo.
  - 100.64.0.0/10 also covers Tailscale addresses.
- **`allowed-peer-ip=<PRIVATE_IP>`.** When both players need the relay, the pair resolves to coturn's own private IP, which the 10/8 deny would block. Allow overrides deny, as documented. coturn also automatically allows the private half of `external-ip` (its log says `Whitelisting external-ip private part`), so this line is redundant, but I keep it so the intent is explicit.
  - **A side effect worth knowing:** because of this mapping, relay-to-relay traffic is delivered *inside* coturn and never touches the router. It works with NAT reflection off, and it does **not** exercise the relay port forwards. That's why a test that relays to itself would pass even with broken forwards (see [Foundry and the module](#foundry-and-the-module)).

### Capacity: how the three limits interact

There are three independent ceilings, and **the lowest one wins**:

| Limit | Setting | My ceiling |
|---|---|---|
| Relay ports | `min-port` to `max-port` (and the matching firewall forward) | 300 allocations, one port each |
| Allocation quota | `total-quota` and `user-quota` | 300 |
| Bandwidth reservation | `bps-capacity` ÷ `max-bps` | 12,000,000 ÷ 32,000 = 375 |

- **`bps-capacity` is a reservation pool, not a meter.** Every allocation reserves its full `max-bps` up front, regardless of actual traffic. This is what broke the first game day. A refusal is `486 Allocation Bandwidth Quota Reached`.
- **`user-quota` can't limit individual players.** Everyone shares one username, so it's effectively a second total cap.
- **Demand is bigger than "players × peers".**
  - Each browser opens one allocation **per peer connection**: 7 players connect to 6 others each, which is 42 allocations.
  - Chromium can allocate **per local network interface**: Ethernet, Wi-Fi, Tailscale, WSL or Hyper-V virtual adapters, and VPN adapters each count.
  - After a reload, the old allocations stay alive until they expire while new ones are made.
  - The module's relay test briefly adds one allocation per player.

  So a 7-player table can plausibly reach 80–100+.
- **`max-bps=32000` is in bytes per second**, with incoming and outgoing counted separately: about 256 kbps each way. That's the real per-session cap against abuse. Opus voice uses about 8 KB/s.
- **I sized ports, quotas and the reservation to agree (about 300)**, so no hidden ceiling sits below the others. **If you change one, recompute all three.** When widening the port range, change the firewall forward **first**, then coturn. Otherwise coturn hands out ports the firewall doesn't forward.

### Check after any config change

```bash
systemctl restart coturn && sleep 2 && ss -lunpt | grep turnserver
journalctl -u coturn -b --no-pager | grep -Ei 'warn|error|cannot|unknown|bad|external|listener'
```

- Expect listeners on `<PRIVATE_IP>:3478` only (one UDP and one TCP socket per CPU thread), and nothing on 5349, 5766, 8080 or 9641.
- **Check the process ID and timestamp on any error line:** errors from earlier runs stay in the journal.
- Then run the load test from an outside network (see [Testing](#testing)). It's the only check that proves capacity.

---

## Keeping external-ip current

My public IP can change, and coturn 4.6.1 only accepts a literal IP. So a small script runs every minute. It looks up the relay's public name and, if the IP no longer matches `external-ip`, rewrites that line and restarts coturn.

- **It asks public resolvers on purpose.** A local resolver could one day return a private address, if a split-DNS override for the name were ever added. Asking public resolvers ties the advertised IP to exactly what players resolve.
- **It fails closed:** if the lookup fails or returns something other than an IPv4 address, nothing changes. If the `external-ip` line is missing, it logs that and does nothing, so it can't get into a restart loop.
- **It restores `root:turnserver 640` after `sed -i`**, because `sed -i` replaces the file and loses its ownership.
- **Worst-case delay after an IP change:** about 3 minutes (dynamic DNS 60 s, resolver TTL 60 s, timer 60 s).

`/usr/local/sbin/turn-extip.sh` (mode 755):

```bash
#!/bin/bash
# turn-extip: keep coturn's external-ip in sync with the relay's public name (via public DNS)
set -u
CONF=/etc/turnserver.conf
PRIV=<PRIVATE_IP>
NAME=turn.example.com

if ! grep -q '^external-ip=' "$CONF"; then
  logger -t turn-extip "no external-ip line in $CONF; refusing to act"
  exit 1
fi

NEW=""
for R in 1.1.1.1 1.0.0.1; do
  NEW=$(dig +short +time=3 +tries=1 A "$NAME" @"$R" | head -n1)
  [[ $NEW =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] && break
  NEW=""
done

if [[ -z $NEW ]]; then
  logger -t turn-extip "lookup failed for $NAME; config unchanged"
  exit 1
fi

CUR=$(grep -m1 '^external-ip=' "$CONF" | cut -d= -f2 | cut -d/ -f1)
[[ $NEW == "$CUR" ]] && exit 0

sed -i "s|^external-ip=.*|external-ip=$NEW/$PRIV|" "$CONF"
chown root:turnserver "$CONF"
chmod 640 "$CONF"
systemctl restart coturn
logger -t turn-extip "external-ip changed: $CUR -> $NEW; coturn restarted"
```

It's run by two systemd units:
- **`turn-extip.service`:** `Type=oneshot`, `ExecStart=/usr/local/sbin/turn-extip.sh`, with `After=` and `Wants=` set to `network-online.target`.
- **`turn-extip.timer`:** `OnBootSec=30s`, `OnUnitActiveSec=60s`, `WantedBy=timers.target`.

**I tested it** by writing a wrong `external-ip` and running the service. It corrected the IP, kept the file's ownership, logged the change, and coturn came back up.

---

## Monitoring

A "dead man's switch" check runs inside the container (I use healthchecks.io). Every 5 minutes it sends a STUN binding request to coturn's own address:
- On success, it pings the monitoring service.
- After two failures in a row, it reports a failure.
- If the pings stop entirely (coturn, the container or its host is down), the service alerts on its own.

**Details:**
- **The monitoring service's check:** a 5-minute period with a 10-minute grace period.
- **One retry after 5 seconds** before reporting a failure, so a restart by `turn-extip` can't cause a false alarm.
- **It looks for `reflexive addr` in the output** rather than trusting `turnutils_stunclient`'s exit code.

**What it doesn't cover:**
- **Breakage on the public path**, such as NAT or firewall rule changes.
- **Running out of capacity.** A STUN binding needs no allocation, so the check stays green while the relay is full. On a game day, the module's relay test is the check for capacity and path (see [Foundry and the module](#foundry-and-the-module)).

`/usr/local/sbin/turn-health.sh` (mode 700, because it contains the ping URL):

```bash
#!/bin/bash
# turn-health: local STUN self-check -> monitoring service ("dead man's switch")
HC="https://hc-ping.com/<YOUR-CHECK-UUID>"
for attempt in 1 2; do
  if timeout 10 turnutils_stunclient <PRIVATE_IP> 2>&1 | grep -q 'reflexive addr'; then
    curl -fsS -m 10 --retry 3 "$HC" >/dev/null
    exit 0
  fi
  sleep 5
done
curl -fsS -m 10 --retry 3 "$HC/fail" >/dev/null
logger -t turn-health "STUN self-check failed twice; reported fail"
exit 1
```

It's run by two systemd units:
- **`turn-health.service`:** `Type=oneshot`, `After=network-online.target coturn.service`.
- **`turn-health.timer`:** `OnBootSec=2min`, `OnUnitActiveSec=5min`.

**I tested it** by stopping coturn: two failures were logged and I got a DOWN alert, then an UP alert after the restart. A failed run leaves the unit marked `failed`, which is intended. coturn's own service already restarts on failure (`Restart=on-failure` is Debian's default).

---

## Firewall and NAT

My firewall is OPNsense. The ideas carry over to other firewalls; the specifics won't.

### Aliases
| Alias | Type | Value | Description |
|---|---|---|---|
| `service_turn` | Host | `<PRIVATE_IP>` | The relay host |
| `turn_listen` | Port | `3478` | coturn listener |
| `turn_relay` | Port | `49160:49459` | coturn relay range. **Must match** `min-port`/`max-port` in coturn's config. |

Every rule refers to these aliases, so widening the relay range is a one-field change, and the NAT and pass rules follow automatically.

### Port forwards (destination NAT)
| | Protocol | Destination | Port | Target | Target port | Version | NAT reflection |
|---|---|---|---|---|---|---|---|
| A | TCP/UDP | WAN address | `turn_listen` | `service_turn` | `turn_listen` | IPv4 | **Disabled** |
| B | UDP | WAN address | `turn_relay` | `service_turn` | `turn_relay` | IPv4 | **Disabled** |

I disabled NAT reflection explicitly. With it on, the relay could loop back to the WAN address and reach other services I forward.

### WAN pass rules (added manually, not auto-created)
| | Protocol | Source | Destination | Port |
|---|---|---|---|---|
| 1 | TCP/UDP | any | `service_turn` | `turn_listen` |
| 2 | UDP | any | `service_turn` | `turn_relay` |

The destination is the *internal* alias, because the firewall applies port forwards before filtering. The source is "any" by design: coturn's authentication, deny list and permissions are the control.

### Outbound NAT: static port
One manual outbound NAT rule: interface WAN, source `service_turn`, destination any, translation to the interface address, **static port: yes**.

Why: by default the firewall randomizes outbound source ports, which behaves like symmetric NAT. coturn advertises `<PUBLIC_IP>:49170`, for example; without static ports, its outgoing packets would leave from a random port. I scoped the rule to this one host, since port randomization is a real defense for everything else.

### A firewall bug: a built-in named port silently dropped from NAT
Port forward A originally used OPNsense's built-in named port **`NAT-STUN-PORT` (3478)**. The interface showed it correctly, and filter rules used it correctly. But the port-forward page **silently left the forward out**, with no error anywhere.

The symptom: incoming connection attempts arrived on WAN and were logged as `Default deny`, still addressed to the WAN IP (never translated), so they never reached the relay. Setting the version to IPv4 alone didn't fix it. Swapping to my own port alias did.

**The lessons:**
- **In NAT rules, use your own port aliases or literal numbers**, never built-in named ports.
- **The interface shows what you configured; `pfctl -s nat` and `pfctl -s rules` show what's actually running.** Compare them first when NAT traffic doesn't arrive.

---

## DNS

- **A record for `turn.example.com` pointing at the WAN IP, DNS only.**
  - On Cloudflare, proxied records answer with Cloudflare's own IPs, and its proxy can't carry UDP TURN, so make sure it is grey-cloud.
- **TTL of 1 minute.** This record points at *your* IP, so after a WAN IP change, the TTL is how long the outage lasts.
- **The record is included in my dynamic DNS updates.** If you've gotten this far, I assume you are doing the same, so remember to include it.
- **Exposing the WAN IP was acceptable for me**: I already forward other services directly, and WebRTC reveals public addresses anyway. This is why we VLAN and isolate, people.
- **To check:** `dig +short turn.example.com @1.1.1.1` should return the real WAN IP and nothing else.

---

## Foundry and the module

**Foundry:** open **Configure Settings → Configure Audio/Video → Server**, set **Relay Server** to **Custom**, and enter:
- **URL:** `turn:turn.example.com:3478`
- **Username and password:** the TURN credentials

Players must reload to pick it up. Saving the relay settings again, even unchanged, makes every browser re-run this module's self-test.

**A limitation: UDP only.** A player on a network that blocks all UDP can't use this relay. A TCP (`?transport=tcp`) or TURNS-on-443 fallback would need a second relay URL. Foundry accepts only one, so that would mean a change to this module. I've deferred it until a real player needs it.

**The module's relay checks:**
- **The self-test** only shows that a browser can *get* a relay address. It passed straight through the game-day capacity failure.
- **The end-to-end relay test** (module 1.6.5) runs from each player to the GM. Each player opens a short data-only connection to the GM's browser, with the player's side restricted to the relay and the GM's side using any route. That crosses the relay's port forwards, static-port outbound NAT and network segment exactly like real voice.
  - A test inside one browser, relaying to itself, would **pass falsely** here, because coturn delivers relay-to-relay traffic internally and skips all of that.
  - The module also reports the browser's `icecandidateerror` codes: **486** relay full, **508** out of capacity, **401** bad credentials, **701** unreachable. The browser is the only place a 486 is visible (see [Testing](#testing)).

**A client-side problem I hit:** on the GM's machine, Firefox's privacy preferences `media.peerconnection.ice.default_address_only`, `proxy_only` and `relay_only` were set to `true`, through privacy hardening or uBlock's WebRTC option. That made address gathering hang forever. Resetting them to their defaults fixed it. The module's self-test now detects a browser that offers no addresses and names these preferences.

---

## Testing

**How I tested:**
- **From a genuinely outside network.** Testing from inside the relay's own network needs NAT hairpinning, so those results aren't valid.
- **When something failed, I narrowed it down** with packet captures at each hop (WAN, the network segment, `tcpdump` in the container), plus the live firewall log.
- **I reproduced each failure on demand before fixing it**, so the fix had a test.

| Test | Result |
|---|---|
| `turnutils_stunclient turn.example.com` (from home) | Reflexive address is the home IP ✅ |
| `nc -vz turn.example.com 3478`, plus an online port checker | TCP open ✅ |
| `turnutils_uclient -e <a private LAN IP>` (deny test) | `403 (Forbidden IP)`, and the log shows `peer IP <…> denied in the range` ✅ |
| `turnutils_uclient -y` (relay to relay, 2 allocations) | 0% loss ✅ |
| Trickle ICE test page, Android phone on an IPv6-only mobile network (464XLAT) | Relay candidate ✅ |
| Trickle ICE test page, GM's machine in Edge and Firefox (after the preference fix) | Relay candidates ✅ |
| Two-player Foundry voice, the day before the game | Worked ✅, but it stayed under the capacity ceiling, so it proved nothing about capacity |
| **7-player game day, original config** | **❌ Relayed pairs failed, and later joiners got no relay** (see [The first game day](#the-first-game-day)) |
| `turnutils_uclient -y -m 30` (60 allocations), original config | **`486 Allocation Bandwidth Quota Reached`**: the failure reproduced |
| `-m 30` (60 allocations), after the fix | 160 of 160, 0% loss ✅ |
| `-m 100` (200 allocations), after the fix | 499 of 500, 0.2% loss ✅ |

**Gotchas I ran into:**
- **coturn's default log shows errors and denials only.**
  - Successful allocations aren't logged.
  - STUN bindings aren't logged (`log-binding` is off, to resist denial of service).
  - Critically, **486 quota refusals aren't logged either.**

  A clean server log doesn't rule out capacity failures; only the client sees the 486.
- **`Cannot complete Allocation` on the client** means either bad credentials **or** a quota refusal. Check the server log: `credentials are incorrect` means the password; nothing at all likely means quota. To tell them apart, run with `-m 1` (authentication only) and again with `-m 30` (capacity).
- **Load-test capacity with `turnutils_uclient -y -m N`**, which opens 2N allocations at once. Problems that only appear at table scale never show up in two-person tests.
- **Expect `403 Forbidden IP` noise.** ICE tries relaying to every candidate address, including players' private ones. My game-day log showed:
  - home LANs (192.168.x.x);
  - WSL or Hyper-V virtual adapters (172.20–27.x.1);
  - a Tailscale address (100.64/10).

  All were private and all correctly refused. To summarise, run `grep -oE 'peer IP [0-9a-f.:]+' | sort | uniq -c`.
- **What a 701 from Chromium means:**
  - *"host lookup received error"*, alongside a relay candidate: the failed **IPv6** lookup (there's no AAAA record). Harmless. A 701 with *no* relay candidate is a real problem.
  - *"request timed out"*: packets left the client but nothing came back, so a path problem.
  - *"host lookup"* with no candidates at all: a DNS problem on the client. I saw it through a VPN.
- **A `192.0.0.4` host candidate** is a CLAT address: the client is on an IPv6-only network with 464XLAT.
- **An internet scanner probed TCP 3478 within minutes** of it going live (`Connection reset by peer`). That's normal background noise.

---

## The first game day

**Symptoms:**
- In the module's self-test, most browsers got relay addresses, but relayed pairs still failed to connect. For example, two players who both had relay addresses couldn't reach each other.
- One player, on a network that blocks direct connections, connected to nobody.
- Two clients, the GM and one other, got no relay address at all.
- And yet, the three-player test the day before had worked perfectly.

**Root cause:** `bps-capacity=1000000` with `max-bps=32000`. coturn reserves each allocation's full `max-bps` from `bps-capacity`, so the server topped out at about 31 concurrent relays. Whoever connected first got relays; everyone after was refused with `486 Allocation Bandwidth Quota Reached`.

The original sizing assumed about 30 allocations at worst, which was wrong on two counts:
- It ignored per-interface allocations, reload churn and one allocation per peer connection.
- It treated `bps-capacity` as a bandwidth ceiling instead of a limit on how many sessions can exist.

**Why it was invisible:**
- coturn doesn't seem to log 486s at default verbosity; its session log showed `quota: 0` and `bandwidth: 0`.
- The module's self-test only checked that an address could be obtained.
- The two-player test stayed under the ceiling.

**My first diagnosis was wrong**, which is worth remembering. I first suspected `user-quota` (60 at the time), which was plausible because of the shared username. Reproducing the failure showed the bandwidth reservation was the limit that bit, below the quota.

**The fix:**
1. I widened the relay port forward to 49160–49459 first.
2. Then coturn: `max-port=49459`, `total-quota` and `user-quota` set to 300, and `bps-capacity=12000000`.
3. I confirmed it with 60- and 200-allocation load tests, at about 0% loss.

**Lessons:**
- **Size capacity from demand** (players × peers × network interfaces × reload churn), not from "concurrent calls", and check every limit as a count of sessions.
- **Reproduce before fixing.** The `-m 30` test turned a game-day mystery into a one-line error.
- **A health check proves the service answers, not that it has room.** Capacity needs its own check.
- **"No errors in the log" is only evidence if that error would have been logged.** Know your log verbosity.

---

## Left for later

- **A TCP or TURNS-on-443 fallback**, only if a player on a network that blocks UDP turns up. It needs work in this module, plus routing 443 by hostname on the reverse proxy.
- **`verbose` logging in coturn**, if I need to see quota or allocation refusals on the server. The trade-off is a much noisier journal.

---

## Command reference

On the relay host:

```bash
# Service and logs
systemctl status coturn
journalctl -u coturn -f
journalctl -t turn-extip -t turn-health -n 20 --no-pager
systemctl list-timers turn-extip.timer turn-health.timer --no-pager

# Listeners and live capacity settings
ss -lunpt | grep turnserver
grep -E '^(min-port|max-port|total-quota|user-quota|max-bps|bps-capacity)=' /etc/turnserver.conf

# Advertised IP vs. public DNS
grep ^external-ip /etc/turnserver.conf
dig +short turn.example.com @1.1.1.1

# After a session: refusals, denials and bad passwords (adjust the date)
journalctl -u coturn --since 2026-11-12 --no-pager > /root/session.log
echo quota: $(grep -ciE 'quota|486' /root/session.log); echo forbidden: $(grep -ciE '403|forbidden|denied' /root/session.log); echo badcreds: $(grep -ci 'credentials are incorrect' /root/session.log)
grep -oE 'peer IP [0-9a-f.:]+' /root/session.log | sort | uniq -c | sort -rn | head -20
```

On the firewall (pf-based, e.g. OPNsense):

```bash
pfctl -s nat | grep -E '3478|49160'
pfctl -s rules | grep -E '3478|49160'
```

From an outside network (the `coturn` package provides the `turnutils_*` tools):

```bash
turnutils_stunclient turn.example.com
read -rsp 'pw: ' P; echo
turnutils_uclient -u <USERNAME> -w "$P" -e <a private LAN IP> -n 1 turn.example.com   # expect 403
turnutils_uclient -y -m 1 -u <USERNAME> -w "$P" -n 5 turn.example.com                 # authentication only
turnutils_uclient -y -m 30 -u <USERNAME> -w "$P" -n 5 turn.example.com                # capacity: 60 allocations
turnutils_uclient -y -m 100 -u <USERNAME> -w "$P" -n 5 turn.example.com               # headroom: 200 allocations
```
