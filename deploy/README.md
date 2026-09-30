# Deploying C.A.R.E. to AWS EC2 (free tier)

The live site is <https://care.dxu.info>. Server-side names (the `geocache`
service and user, `/opt/geocache`, `/etc/geocache.env`, the database file) keep
the app's original name, so existing installs keep working.

This app is a long-lived Node server that stores everything in a SQLite file on
disk. That means **serverless hosts (AWS Amplify, App Runner, Lambda) will not
work**: their filesystem is ephemeral, so your data would vanish on every
restart and the custom `server.js` never runs. A small always-on VM with a
persistent disk is the right fit. EC2's free tier covers this at **$0 for 12
months**.

The `ec2-setup.sh` script does everything: installs Node + [Caddy](https://caddyserver.com/),
builds the app, runs it as a `systemd` service, and fronts it with Caddy for
**automatic HTTPS**. HTTPS matters because the in-app QR **camera scanner needs a
secure context**, and without it only manual link-based claiming works.

No domain? No problem: the script defaults to a free `<public-ip>.sslip.io`
hostname that still gets a real Let's Encrypt certificate.

---

## 1. Launch the instance

In the AWS Console → **EC2** → **Launch instance**:

| Setting | Value |
| --- | --- |
| Name | `geocache` |
| AMI | **Ubuntu Server 24.04 LTS** |
| Instance type | **t4g.micro** (Arm, free-tier eligible), or `t3.micro` (x86) |
| Key pair | Create/select one so you can SSH in |
| Storage | 20 GiB gp3 (within the 30 GiB free-tier allowance) |

**Network / Security group:** allow inbound:

| Type | Port | Source |
| --- | --- | --- |
| SSH | 22 | My IP |
| HTTP | 80 | `0.0.0.0/0` (and `::/0`) |
| HTTPS | 443 | `0.0.0.0/0` (and `::/0`) |

Port 80 must be open too, since Caddy uses it for the Let's Encrypt challenge and to
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
# export DOMAIN='care.dxu.info'
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

## 6. The Heist (`/heist72`)

`https://<your-domain>/heist72` shows Flabber Geese's note; `/heist` is gone (404).
The maze that used to be at `/heist72` lives only in the
Wayback Machine now; its code and prize image are no longer part of the app, and
deploying deletes them from `/opt/geocache`. Nothing to configure.
`/var/lib/geocache/maze-seed`, left over from when the maze was live, is no
longer used and can be deleted.

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
- **Caddy site:** `/etc/caddy/sites/geocache.caddy`. The main `/etc/caddy/Caddyfile`
  only imports `/etc/caddy/sites/*.caddy`, so any other app on the box can keep
  its own file there and re-running this setup won't remove it.

### Update to the latest code

```bash
export GITHUB_TOKEN='github_pat_...'   # only needed for a private repo
sudo -E bash /opt/geocache/deploy/update.sh
```

With auto-deploy on (below) you normally don't need this.

### Auto-deploy after a PR merges

A systemd timer checks GitHub every 2 minutes. When `main` has a new commit and
the **CI** workflow has passed on that exact commit, it deploys it with
`update.sh`. It then checks that `/` and `/heist72` answer, and rolls back to the
previous commit if the build or that check fails. (The check list is read when
a run starts, from the version already deployed, so a change that removes a
checked page must first ship an updated list in its own deploy.) A commit whose CI failed isn't
deployed, but it's re-checked every run, so re-running CI (Actions → the run →
"Re-run failed jobs") and getting a pass deploys it. Nothing needs to reach into
the server: it pulls, so there's no SSH access or deploy secret on GitHub.

Turn it on once, after the box has code that includes `deploy/auto-deploy.sh`:

```bash
sudo -E bash /opt/geocache/deploy/update.sh              # if the box predates auto-deploy
sudo bash /opt/geocache/deploy/install-auto-deploy.sh
```

For a private repo, pass a read-only token so it can see `main` and CI results:
`sudo GITHUB_TOKEN='github_pat_...' bash /opt/geocache/deploy/install-auto-deploy.sh`.

```bash
sudo journalctl -u geocache-auto-deploy -e             # what it did, and why
systemctl list-timers geocache-auto-deploy.timer       # when it next runs
sudo systemctl start geocache-auto-deploy              # check right now
sudo systemctl disable --now geocache-auto-deploy.timer  # turn it off
```

A merged PR typically goes live 5 to 10 minutes after merging: CI on `main`,
then up to 2 minutes until the next check, then the rebuild.

### Back up / restore the database

```bash
# Back up (safe while running; copies the DB and WAL)
mkdir -p ~/geocache-backup
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

- **Build hangs at "rendering chunks…" or gets killed:** the instance ran out of
  memory (a `t4g.micro`/`t3.micro` has only 1 GB RAM and no swap). `ec2-setup.sh`
  now adds a 2 GB swap file automatically. If you hit this building manually, add
  swap first:
  ```bash
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  ```
  then re-run the build.
- **Cert didn't issue / site not secure:** ensure ports **80 and 443** are open
  in the Security Group, then `sudo journalctl -u caddy -f` and
  `sudo systemctl reload caddy`.
- **Camera scanner won't open on phones:** you must be on the `https://` URL
  (the sslip.io or your domain), not the raw IP.
- **502 from Caddy:** the app isn't up. Run `sudo systemctl status geocache` and
  check `sudo journalctl -u geocache -e`.
