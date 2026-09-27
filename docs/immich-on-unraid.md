# Installing Immich on Unraid for Werejugo

Werejugo keeps every family's photos and videos in **Immich**, a self-hosted photo server running next to Werejugo on the same Unraid box.

- Immich does the heavy lifting: it reads iPhone HEIC and camera RAW files, converts videos, makes thumbnails, finds duplicates and recognises faces.
- Werejugo shows the photos in its own pages; nobody has to open Immich.
- Families that want to can still use Immich's web page at home. Werejugo sees photos added there too.

This guide installs Immich **3.x** with your **NVIDIA RTX 5070** doing face recognition and video conversion. It takes about 30 minutes plus a reboot.

> Werejugo supports Immich **3.2 or newer, before 4.0**. Keep `IMMICH_VERSION=v3` (below) so updates stay within version 3 until Werejugo says 4.0 is supported.

---

## 1. Install the plugins

In Unraid → **Apps** (Community Applications), install:

1. **Nvidia Driver** (by ich777).
   - Open it from **Settings → Nvidia Driver**.
   - Choose the latest **production branch** driver, click **Update & Download**, and reboot when it says so.
   - RTX 50-series cards need a 570-series driver or newer.
   - After the reboot, the plugin page should list your *GeForce RTX 5070*. Note its **GPU UUID** in case you want to pin Immich to that card.
2. **Docker Compose Manager** (by dcflachs). It adds a **Compose** section at the bottom of the **Docker** tab.

## 2. Pick the folders

| What | Suggested path | Notes |
|---|---|---|
| Photo library | `/mnt/user/photos/immich` | Originals, thumbnails and encoded videos. Big: put it on the array or a large pool. Create the `photos` share first if you don't have one. |
| Immich database | `/mnt/cache/appdata/immich/postgres` | **Must be on an SSD pool, written as `/mnt/<pool>/…`**, not `/mnt/user/…`. The database breaks on Unraid's `/mnt/user` share layer. If your pool isn't called `cache`, use its name. |

## 3. Create the stack

1. Go to **Docker** → **Compose** → **Add New Stack**. Name it `immich`.
2. Click the gear next to `immich` → **Edit Stack** → **Compose File**. Paste the following and save:

```yaml
name: immich

services:
  immich-server:
    container_name: immich_server
    image: ghcr.io/immich-app/immich-server:${IMMICH_VERSION:-v3}
    volumes:
      - ${UPLOAD_LOCATION}:/data
      - /etc/localtime:/etc/localtime:ro
    env_file:
      - .env
    ports:
      - '2283:2283'
    # NVIDIA: video conversion on the GPU (NVENC)
    runtime: nvidia
    environment:
      NVIDIA_VISIBLE_DEVICES: all
      NVIDIA_DRIVER_CAPABILITIES: compute,video,utility
    depends_on:
      - redis
      - database
    restart: always
    healthcheck:
      disable: false

  immich-machine-learning:
    container_name: immich_machine_learning
    # "-cuda": face recognition and smart search on the GPU
    image: ghcr.io/immich-app/immich-machine-learning:${IMMICH_VERSION:-v3}-cuda
    volumes:
      - model-cache:/cache
    env_file:
      - .env
    runtime: nvidia
    environment:
      NVIDIA_VISIBLE_DEVICES: all
      NVIDIA_DRIVER_CAPABILITIES: compute,utility
    restart: always
    healthcheck:
      disable: false

  redis:
    container_name: immich_redis
    image: docker.io/valkey/valkey:9@sha256:70739f85ad2ee01a726a965584a0f94895f01b0c60b3cc8b0aeef11eaa6888cf
    healthcheck:
      test: redis-cli ping | grep -q PONG || exit 1
    restart: always

  database:
    container_name: immich_postgres
    image: ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0@sha256:bcf63357191b76a916ae5eb93464d65c07511da41e3bf7a8416db519b40b1c23
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_USER: ${DB_USERNAME}
      POSTGRES_DB: ${DB_DATABASE_NAME}
      POSTGRES_INITDB_ARGS: '--data-checksums'
    volumes:
      - ${DB_DATA_LOCATION}:/var/lib/postgresql/data
    shm_size: 128mb
    restart: always
    healthcheck:
      disable: false

volumes:
  model-cache:
```

   This is Immich 3.2.2's official `docker-compose.yml`, with the NVIDIA settings written in, so no extra files are needed.

3. Gear → **Edit Stack** → **ENV File**. Paste this, change the three marked lines, and save:

```ini
# Where photos and videos are stored (step 2)
UPLOAD_LOCATION=/mnt/user/photos/immich
# Where Immich's database lives: SSD pool path, not /mnt/user (step 2)
DB_DATA_LOCATION=/mnt/cache/appdata/immich/postgres
# Your time zone                                               <- change
TZ=America/Los_Angeles
# Stay on Immich 3 until Werejugo supports 4
IMMICH_VERSION=v3
# Random letters and digits only, no symbols                   <- change
DB_PASSWORD=ReplaceWithALongRandomPassword123
DB_USERNAME=postgres
DB_DATABASE_NAME=immich
```

   For `DB_PASSWORD`, anything long of letters and digits works. On the Unraid terminal, `openssl rand -hex 24` makes one.

4. Click **Compose Up**. The first start downloads several GB of images (the GPU face-recognition image is the big one). When it finishes, the four `immich_*` containers show as running in the Docker tab.

## 4. First sign-in and the key for Werejugo

1. Open `http://<your-unraid-ip>:2283` and click **Getting started**.
   - Create the **Immich admin** account. This is your server-admin login for Immich. Werejugo creates separate Immich accounts for each family, so your family's photos won't land in this admin account.
2. Turn on GPU video conversion:
   - Go to **Administration → Settings → Video Transcoding Settings → Hardware Acceleration**.
   - Set **Acceleration API** to **NVENC**, turn on **Hardware decoding**, and save.
   - Face recognition already uses the GPU through the `-cuda` image.
3. Make the key Werejugo will use:
   - Click your avatar → **Account Settings → API Keys → New API Key**.
   - Name it `Werejugo`, choose **all** permissions, and copy the key it shows. It's only shown once.

## 5. Connect Werejugo

This needs the Werejugo version with the Immich connection (Milestone 2, phase 2.1). The preview image `claude-cool-hopper-pku4ne` has it once 2.1 is finished.

1. In the Unraid **werejugo-backend** container, add a variable **`ENCRYPTION_KEY`**:
   - A long random value (`openssl rand -hex 32`), masked.
   - Werejugo uses it to lock away the Immich keys it stores (and, later, document files).
   - **Save a copy somewhere safe.** A backup restored without it needs the Immich key re-entered.
2. In Werejugo, go to **Admin → Immich**:
   - Enter `http://<your-unraid-ip>:2283` and paste the key.
   - Click **Test & save**, then **Connect all families**. Each family gets its own Immich account.
3. **Optional:** a family owner can set the family's Immich password (**Settings → Family → Photos**) to use Immich's own web page or app on the home network.

## 6. Keep Immich private

- Don't add Immich to your Cloudflare tunnel. Werejugo reaches it over your home network and shows photos through its own pages, so Immich never needs to be on the internet.
- If you previously forwarded port 2283 on your router, remove that.

## 7. Backups

- Your photos are the files under `UPLOAD_LOCATION`. Include that share in whatever backs up your Unraid (for example an off-site copy of `/mnt/user/photos`).
- By default, Immich also saves a copy of its own database every night to `UPLOAD_LOCATION/backups`, so backing up the library folder covers the database too.
- Werejugo's **Admin → Backup** covers Werejugo's data (places, trips, documents), not the photos in Immich. Keep both backups.

## Troubleshooting

- **Containers restart in a loop:**
  1. Open the `immich_server` log (Docker tab → the container's icon → **Logs**).
  2. The most common cause is `DB_DATA_LOCATION` on a `/mnt/user/…` path. Move it to `/mnt/<pool>/…` and delete the half-created database folder.
- **No GPU in the logs, or CUDA errors in `immich_machine_learning`:**
  1. Check that the Nvidia Driver plugin page lists the card.
  2. Check that the driver is 570 or newer.
  3. As a fallback, remove `-cuda` from the machine-learning image, remove the two `runtime: nvidia` blocks, and **Compose Up** again. Everything keeps working on the CPU, just more slowly for the first big scan.
- **Werejugo says it can't reach Immich:** use the Unraid server's LAN IP address (not `localhost`) with port `2283`, and check that `http://<ip>:2283` opens from another computer.
- **Updating:** Docker → Compose → gear on `immich` → **Update Stack** (pulls newer 3.x images) → **Compose Up**. Read Immich's release notes first; Werejugo's Admin → Immich page shows whether the new version is supported.
