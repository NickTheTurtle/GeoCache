# Deploying GeoCache SF to AWS EC2 (free tier)

This app is a long-lived Node server that stores everything in a SQLite file on
disk. That means **serverless hosts (AWS Amplify, App Runner, Lambda) will not
work** — their filesystem is ephemeral, so your data would vanish on every
restart and the custom `server.js` never runs. A small always-on VM with a
persistent disk is the right fit. EC2's free tier covers this at **$0 for 12
months**.

The `ec2-setup.sh` script does everything: installs Node + [Caddy](https://caddyserver.com/),
builds the app, runs it as a `systemd` service, and fronts it with Caddy for
**automatic HTTPS**. HTTPS matters because the in-app QR **camera scanner needs a
secure context** — without it, only manual link-based claiming works.

No domain? No problem: the script defaults to a free `<public-ip>.sslip.io`
hostname that still gets a real Let's Encrypt certificate.

---

## 1. Launch the instance

In the AWS Console → **EC2** → **Launch instance**:

| Setting | Value |
| --- | --- |
| Name | `geocache` |
| AMI | **Ubuntu Server 24.04 LTS** |
| Instance type | **t4g.micro** (Arm, free-tier eligible) — or `t3.micro` (x86) |
| Key pair | Create/select one so you can SSH in |
| Storage | 20 GiB gp3 (within the 30 GiB free-tier allowance) |

**Network / Security group** — allow inbound:

| Type | Port | Source |
| --- | --- | --- |
| SSH | 22 | My IP |
| HTTP | 80 | `0.0.0.0/0` (and `::/0`) |
| HTTPS | 443 | `0.0.0.0/0` (and `::/0`) |

Port 80 must be open too — Caddy uses it for the Let's Encrypt challenge and to
redirect to HTTPS.

> If you pick `t4g.micro`, confirm it's free-tier eligible in your account/region;
> otherwise use `t3.micro`. The setup script works on either architecture.

## 2. Connect

```bash
ssh -i /path/to/key.pem ubuntu@<public-ip>
```

## 3. Get the code onto the box

The repo is private, so create a **fine-grained GitHub PAT** with
*Contents: Read-only* access to `NickTheTurtle/GeoCache`
(GitHub → Settings → Developer settings → Fine-grained tokens), then:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/NickTheTurtle/GeoCache.git
# Username: NickTheTurtle
# Password: <paste the PAT>
cd GeoCache
```

## 4. Run the setup script

```bash
export ADMIN_PASSWORD='pick-a-strong-password'
export GITHUB_TOKEN='github_pat_...'   # the same PAT, so the script can clone to /opt/geocache

# Optional: use your own domain instead of sslip.io
#   (point its DNS A record at this instance's public IP first)
# export DOMAIN='geocache.example.com'
# export ACME_EMAIL='you@example.com'

sudo -E bash deploy/ec2-setup.sh
```

`sudo -E` preserves your exported variables. When it finishes it prints your
app URL, e.g. `https://<public-ip>.sslip.io`. The first request can take a few
seconds while Caddy fetches the certificate.

## 5. Point QR codes at the public URL

The script sets `PUBLIC_BASE_URL` to your HTTPS address, so QR codes generated
from the **admin** page (`/admin`) already encode the correct public link.
(Re)generate them there after deploying.

---

## Operating it

```bash
sudo systemctl status geocache      # service state
sudo journalctl -u geocache -f      # app logs
sudo systemctl restart geocache     # restart
```

- **App code:** `/opt/geocache`
- **Config/secrets:** `/etc/geocache.env` (root-only, contains `ADMIN_PASSWORD`)
- **Database:** `/var/lib/geocache/geocache.db` (survives restarts, redeploys, and reboots)

### Update to the latest code

```bash
export GITHUB_TOKEN='github_pat_...'   # only needed for a private repo
sudo -E bash /opt/geocache/deploy/update.sh
```

### Back up / restore the database

```bash
# Back up (safe while running — copies the DB and WAL)
sudo cp /var/lib/geocache/geocache.db* ~/geocache-backup/

# Restore
sudo systemctl stop geocache
sudo cp ~/geocache-backup/geocache.db* /var/lib/geocache/
sudo chown geocache:geocache /var/lib/geocache/geocache.db*
sudo systemctl start geocache
```

---

## Cost

- **Free for 12 months** on the free tier (750 instance-hours/month + 30 GiB
  storage). One `t4g.micro`/`t3.micro` running 24/7 fits within the hours.
- After the free year, roughly **$6–8/month** for the instance + EBS volume.
- If you'd rather not manage a VM, **AWS Lightsail** is a flat ~$5/month with the
  same persistent-disk model.

## Troubleshooting

- **Cert didn't issue / site not secure:** ensure ports **80 and 443** are open
  in the Security Group, then `sudo journalctl -u caddy -f` and
  `sudo systemctl reload caddy`.
- **Camera scanner won't open on phones:** you must be on the `https://` URL
  (the sslip.io or your domain), not the raw IP.
- **502 from Caddy:** the app isn't up — `sudo systemctl status geocache` and
  check `sudo journalctl -u geocache -e`.
